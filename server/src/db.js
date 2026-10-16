// Pool de conexiones MySQL y utilidades de transacción
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'inventario_it',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  charset: 'utf8mb4_unicode_ci', // misma collation que la BD (evita 'Illegal mix of collations')
});

// BD corporativa de usuarios (ing039) para autenticar. Opcional: sin AUTH_DB_NAME solo hay login local.
const poolAuth = process.env.AUTH_DB_NAME ? mysql.createPool({
  host: process.env.AUTH_DB_HOST || process.env.DB_HOST || 'localhost',
  port: Number(process.env.AUTH_DB_PORT || process.env.DB_PORT || 3306),
  user: process.env.AUTH_DB_USER || process.env.DB_USER || 'root',
  password: process.env.AUTH_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
  database: process.env.AUTH_DB_NAME,
  connectionLimit: 3,
  charset: 'utf8mb4_general_ci',
}) : null;

/** Ejecuta una consulta preparada y devuelve las filas. */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Ejecuta fn(conn) dentro de una transacción. Hace rollback si falla. */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, poolAuth, query, transaction };
