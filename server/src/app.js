// Servidor Express: API REST + web estática + PWA
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PROD = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

app.set('trust proxy', 1); // detrás de un proxy HTTPS en producción
// Servida por HTTP en la red interna: sin upgrade-insecure-requests ni HSTS, o el navegador pide CSS/JS por HTTPS y fallan
const SOLO_HTTPS = (process.env.PUBLIC_URL || '').startsWith('https://');
app.use(helmet({
  strictTransportSecurity: SOLO_HTTPS,
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: SOLO_HTTPS ? [] : null,
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com', "'wasm-unsafe-eval'"], // html5-qrcode (respaldo) y WASM del lector de etiquetas
      workerSrc: ["'self'", 'blob:'],                                     // OCR (tesseract) en un worker
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
    },
  },
}));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'inv.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-cambiar',
  store: new MySQLStore({}, pool),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: PROD, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 10 },
}));

// ---- API ----
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 50 }), require('./routes/auth'));
app.use('/api', requireAuth);
app.use('/api/equipos', require('./routes/equipos'));
app.use('/api/asignaciones', require('./routes/asignaciones'));
app.use('/api/disponibilidad', require('./routes/disponibilidad'));
app.use('/api/personas', require('./routes/personas'));
app.use('/api/incidencias', require('./routes/incidencias'));
app.use('/api/masterizaciones', require('./routes/masterizaciones'));
app.use('/api/catalogos', require('./routes/catalogos'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// ---- QR: /q/CT-000123 abre la ficha en la PWA ----
app.get('/q/:codigo', (req, res) => res.redirect(`/equipo.html?qr=${encodeURIComponent(req.params.codigo)}`));

// ---- Librerías del lector de etiquetas, servidas en local (la app va en una VM de intranet) ----
const NM = path.join(__dirname, '..', 'node_modules');
const VENDOR = { maxAge: '30d', immutable: true };
app.use('/vendor/zxing', express.static(path.join(NM, 'zxing-wasm/dist/iife/reader'), VENDOR));
app.use('/vendor/zxing', express.static(path.join(NM, 'zxing-wasm/dist/reader'), VENDOR));
app.use('/vendor/tesseract', express.static(path.join(NM, 'tesseract.js/dist'), VENDOR));
app.use('/vendor/tesseract-core', express.static(path.join(NM, 'tesseract.js-core'), VENDOR));
app.use('/vendor/tessdata', express.static(path.join(NM, '@tesseract.js-data/eng/4.0.0_best_int'), VENDOR));

// ---- Web estática y PWA ----
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// ---- Errores ----
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err.code === 'ER_DUP_ENTRY' ? 409 : 500);
  if (status >= 500) console.error(err);
  const msg = err.code === 'ER_DUP_ENTRY' ? 'Ya existe un registro con ese valor' : err.message;
  res.status(status).json({ error: status >= 500 && PROD ? 'Error interno' : msg });
});

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => console.log(`Inventario IT escuchando en http://localhost:${PORT}`));

  // HTTPS opcional (desarrollo): el móvil necesita HTTPS para la cámara y para que la CSP no rompa la página
  if (process.env.HTTPS_CERT && process.env.HTTPS_KEY) {
    const fs = require('fs');
    const base = path.join(__dirname, '..');
    const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
    require('https').createServer({
      cert: fs.readFileSync(path.resolve(base, process.env.HTTPS_CERT)),
      key: fs.readFileSync(path.resolve(base, process.env.HTTPS_KEY)),
    }, app).listen(HTTPS_PORT, () => console.log(`Inventario IT escuchando en https://<ip-del-equipo>:${HTTPS_PORT}`));
  }
}

module.exports = app;
