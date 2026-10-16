// Autenticación contra la BD corporativa de usuarios (ing039.users, solo lectura).
// Si la contraseña es correcta, refleja el usuario en inventario_it (usuarios, empleados,
// usuario_roles) para que el resto de la app trabaje con sus ids locales.
const argon2 = require('argon2');
const { poolAuth, transaction } = require('../db');

// ing039.roles.id → rol del inventario
const ROLES = {
  1: 'admin_it',     // Admin
  2: 'responsable',  // Project Manager (ámbito: su BU)
  3: 'empleado',     // FTE
  4: 'lector',       // Reader (ve todo, no modifica)
};

/** Busca el usuario corporativo (con contraseña) por email o usuario de Windows. */
async function buscar(login) {
  if (!poolAuth) return null;
  const [rows] = await poolAuth.execute(
    `SELECT Id, User, Password, Rol, Resid, Nombre, Apellidos, BU
       FROM users WHERE (LOWER(User) = ? OR LOWER(WindowsUser) = ?) AND Password <> '' LIMIT 2`,
    [login, login]);
  return rows.length === 1 ? rows[0] : null;
}

/** Comprueba la contraseña (argon2id). Usuarios sin contraseña no pueden entrar. */
async function verificar(ext, password) {
  if (!ext?.Password) return false;
  try { return await argon2.verify(ext.Password, password); } catch { return false; }
}

/** Crea o actualiza la copia local del usuario (sin contraseña) y devuelve su fila. */
async function reflejarUsuario(conn, ext) {
  const email = ext.User.trim().toLowerCase();
  await conn.execute(
    `INSERT INTO usuarios (email, auth_origen) VALUES (?, 'ing039')
     ON DUPLICATE KEY UPDATE auth_origen = 'ing039', password_hash = NULL`, [email]);
  const [[u]] = await conn.execute(
    'SELECT id, empleado_id, email, activo, intentos_fallidos, bloqueado_hasta FROM usuarios WHERE email = ?', [email]);
  return u;
}

/** Sincroniza empleado y roles del usuario local a partir de los datos corporativos. */
async function sincronizar(ext) {
  return transaction(async (conn) => {
    const u = await reflejarUsuario(conn, ext);
    const bu = String(ext.BU || '').trim();
    const resid = String(ext.Resid || '').trim();

    let unId = null;
    if (bu) {
      await conn.execute('INSERT IGNORE INTO unidades_negocio (codigo, nombre) VALUES (?, ?)', [bu, `UN ${bu}`]);
      [[{ id: unId }]] = await conn.execute('SELECT id FROM unidades_negocio WHERE codigo = ?', [bu]);
    }

    let empleadoId = u.empleado_id;
    if (resid && unId) {
      await conn.execute(
        `INSERT INTO empleados (num_empleado, nombre, apellidos, email, un_id, estado, fecha_alta)
         VALUES (?, ?, ?, ?, ?, 'activo', CURDATE())
         ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), apellidos = VALUES(apellidos), un_id = VALUES(un_id)`,
        [resid, ext.Nombre, ext.Apellidos, u.email, unId]);
      // Si el Resid ya pertenece a otro email, el upsert no crea fila para este: queda sin empleado
      const [[emp]] = await conn.execute('SELECT id FROM empleados WHERE email = ?', [u.email]);
      empleadoId = emp?.id ?? null;
    }

    const rol = ROLES[ext.Rol] || 'empleado';
    await conn.execute('DELETE FROM usuario_roles WHERE usuario_id = ?', [u.id]);
    await conn.execute('INSERT INTO usuario_roles (usuario_id, rol, un_id) VALUES (?, ?, ?)',
      [u.id, rol, rol === 'responsable' ? unId : null]);
    await conn.execute('UPDATE usuarios SET empleado_id = ? WHERE id = ?', [empleadoId, u.id]);
    return { ...u, empleado_id: empleadoId };
  });
}

module.exports = { buscar, verificar, reflejarUsuario, sincronizar, ROLES };
