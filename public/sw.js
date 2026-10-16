// Service worker: la interfaz se cachea para abrir rápido y sin conexión.
// Las llamadas GET a la API usan "red primero, caché si no hay conexión";
// las escrituras (POST/PATCH) siempre van a la red.
const VERSION = 'inv-v9';
const SHELL = [
  '/', '/index.html', '/login.html', '/escanear.html', '/equipo.html', '/mis-equipos.html', '/disponibilidad.html',
  '/css/app.css', '/js/api.js', '/js/tablas.js', '/js/firma.js', '/js/lector-etiquetas.js',
  '/js/pages/inventario.js', '/js/pages/login.js', '/js/pages/escanear.js', '/js/pages/equipo.js',
  '/js/pages/mis-equipos.js', '/js/pages/disponibilidad.js',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/logo-ct.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/auth')) return;
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req)));
    return;
  }

  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const red = fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
      return res;
    }).catch(() => hit);
    return hit || red;
  }));
});
