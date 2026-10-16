// Crea (o actualiza) un usuario administrador de IT con contraseña local.
// Uso: npm run crear-admin -- admin@empresa.es MiContraseñaSegura
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

(async () => {
  const [email, password] = process.argv.slice(2);
  if (!email || !password || password.length < 10) {
    console.error('Uso: npm run crear-admin -- <email> <contraseña de 10+ caracteres>');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.execute(
    `INSERT INTO usuarios (email, password_hash, auth_origen) VALUES (?, ?, 'local')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), activo = 1, intentos_fallidos = 0, bloqueado_hasta = NULL`,
    [email.toLowerCase(), hash]);
  const [[u]] = await pool.execute('SELECT id FROM usuarios WHERE email = ?', [email.toLowerCase()]);
  await pool.execute("DELETE FROM usuario_roles WHERE usuario_id = ? AND rol = 'admin_it'", [u.id]);
  await pool.execute("INSERT INTO usuario_roles (usuario_id, rol) VALUES (?, 'admin_it')", [u.id]);
  console.log(`Administrador listo: ${email}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
