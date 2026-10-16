// Autenticación contra la BD corporativa de usuarios (ing039.users, solo lectura).
// En inventario_it solo queda la cuenta (tabla usuarios: email + Id de ing039), que necesitan
// incidencias, asignaciones y auditoría. Nombre, BU, oficina y baja se leen en vivo (lib/personas.js)
// y los roles se calculan en cada login a partir de ing039; no se guardan.
const argon2 = require('argon2');
const { poolAuth } = require('../db');

// ing039.roles.id → rol del inventario
const ROLES = {
  1: 'admin_it',     // Admin
  2: 'responsable',  // Project Manager (ámbito: su BU)
  3: 'empleado',     // FTE
  4: 'lector',       // Reader (ve todo, no modifica)
};

// ¿Tiene ing039.users la columna Baja (fecha de baja, NULL = activo)? Volcados antiguos no la tienen.
let _tieneBaja;
async function tieneBaja() {
  if (_tieneBaja === undefined) {
    const [c] = await poolAuth.query("SHOW COLUMNS FROM users LIKE 'Baja'");
    _tieneBaja = c.length > 0;
    if (!_tieneBaja) console.warn('ing039.users no tiene la columna Baja: no se detectarán bajas');
  }
  return _tieneBaja;
}

/** Busca el usuario corporativo activo (con contraseña) por email o usuario de Windows. */
async function buscar(login) {
  if (!poolAuth) return null;
  const [rows] = await poolAuth.execute(
    `SELECT Id, User, Password, Rol, BU
       FROM users WHERE (LOWER(User) = ? OR LOWER(WindowsUser) = ?) AND Password <> ''
       ${await tieneBaja() ? 'AND Baja IS NULL' : ''} LIMIT 2`,
    [login, login]);
  return rows.length === 1 ? rows[0] : null;
}

/** Comprueba la contraseña (argon2id). Usuarios sin contraseña no pueden entrar. */
async function verificar(ext, password) {
  if (!ext?.Password) return false;
  try { return await argon2.verify(ext.Password, password); } catch { return false; }
}

/** Crea o actualiza la cuenta local (sin contraseña, con el Id de ing039) y devuelve su fila. */
async function reflejarUsuario(conn, ext) {
  const email = ext.User.trim().toLowerCase();
  await conn.execute(
    `INSERT INTO usuarios (email, auth_origen, empleado_id) VALUES (?, 'ing039', ?)
     ON DUPLICATE KEY UPDATE auth_origen = 'ing039', password_hash = NULL, empleado_id = VALUES(empleado_id)`,
    [email, ext.Id]);
  const [[u]] = await conn.execute(
    'SELECT id, empleado_id, email, activo, intentos_fallidos, bloqueado_hasta FROM usuarios WHERE email = ?', [email]);
  return u;
}

/** Roles de la sesión según ing039: [{ rol, bu, proyecto_id }]. El responsable ve su BU. */
function rolesDe(ext) {
  const rol = ROLES[ext.Rol] || 'empleado';
  const bu = String(ext.BU || '').trim() || null;
  return [{ rol, bu: rol === 'responsable' ? bu : null, proyecto_id: null }];
}

module.exports = { buscar, verificar, reflejarUsuario, rolesDe, ROLES };
