// /api/auth — login contra la BD corporativa (ing039, argon2id) o local (bcrypt); sesión en cookie
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../db');
const ing039 = require('../lib/usuarios-ing039');
const personas = require('../lib/personas');
const { ah } = require('../lib/http');
const { requireAuth } = require('../middleware/auth');

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;

router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña obligatorios' });

  const login = String(email).trim().toLowerCase();
  let [u] = await query(
    `SELECT id, empleado_id, email, password_hash, activo, intentos_fallidos, bloqueado_hasta
       FROM usuarios WHERE email = ? AND auth_origen = 'local'`,
    [login]
  );
  // Si no es un usuario local, se busca en la BD corporativa
  const ext = u ? null : await ing039.buscar(login);
  if (ext) u = await transaction((conn) => ing039.reflejarUsuario(conn, ext));
  if (!u || !u.activo) return res.status(401).json({ error: 'Credenciales incorrectas' });
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    return res.status(423).json({ error: 'Cuenta bloqueada temporalmente. Inténtalo más tarde.' });
  }

  const ok = ext ? await ing039.verificar(ext, password) : await bcrypt.compare(password, u.password_hash || '');
  if (!ok) {
    const intentos = u.intentos_fallidos + 1;
    await query(
      `UPDATE usuarios SET intentos_fallidos = ?,
         bloqueado_hasta = IF(? >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NULL)
       WHERE id = ?`,
      [intentos, intentos, MAX_INTENTOS, BLOQUEO_MIN, u.id]
    );
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  await query(
    'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = NOW() WHERE id = ?',
    [u.id]
  );
  // Cuentas de ing039: roles calculados de su Rol y BU actuales; cuentas locales: usuario_roles
  const roles = ext ? ing039.rolesDe(ext) : await query('SELECT rol, bu, proyecto_id FROM usuario_roles WHERE usuario_id = ?', [u.id]);
  if (ext) personas.invalidar();  // que la siguiente consulta vea los datos actuales de ing039

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'No se pudo iniciar la sesión' });
    req.session.user = { id: u.id, empleado_id: u.empleado_id, email: u.email, roles };
    res.json({ user: req.session.user });
  });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('inv.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const p = user.empleado_id ? await personas.porId(user.empleado_id) : null;
  res.json({ user: { ...user, nombre: p?.nombre_completo || user.email, bu: p?.bu || null, oficina: p?.oficina || null } });
}));

module.exports = router;
