// Ejecuta un fichero .sql contra MySQL usando la configuración de .env
// Uso: node scripts/run-sql.js ../database/schema.sql
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Indica el fichero .sql'); process.exit(1); }
  const sql = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci',
  });
  await conn.query(sql);
  await conn.end();
  console.log(`OK: ${file}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
