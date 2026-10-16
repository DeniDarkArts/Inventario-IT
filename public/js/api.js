// Cliente de la API y utilidades comunes de la web/PWA
const API = {
  async req(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(`/api${url}`, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !location.pathname.endsWith('/login.html')) {
      location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; e.data = data; throw e; }
    return data;
  },
  get: (u) => API.req('GET', u),
  post: (u, b) => API.req('POST', u, b),
  patch: (u, b) => API.req('PATCH', u, b),
};

/** Usuario actual (cacheado). */
let _me;
async function me() {
  if (!_me) _me = (await API.get('/auth/me')).user;
  return _me;
}
const tieneRol = (u, ...roles) => u.roles.some((r) => roles.includes(r.rol));
const esIT = (u) => tieneRol(u, 'admin_it', 'tecnico_it');

/** Escapa texto para insertarlo en HTML. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ETIQUETA_ESTADO = {
  en_stock: 'En stock', reservado: 'Reservado', pendiente_master: 'Pendiente master', asignado: 'Asignado',
  en_revision: 'En revisión', en_reparacion: 'En reparación', perdido: 'Perdido', baja_definitiva: 'Baja definitiva',
};
const badge = (estado) => `<span class="badge b-${esc(estado)}">${esc(ETIQUETA_ESTADO[estado] || estado)}</span>`;

function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/** Pinta la barra de navegación según el rol. */
async function nav() {
  const u = await me();
  const links = esIT(u)
    ? [['/', 'Inventario'], ['/disponibilidad.html', 'Disponibilidad'], ['/escanear.html', 'Escanear'], ['/mis-equipos.html', 'Mis equipos']]
    : [['/mis-equipos.html', 'Mis equipos'], ['/escanear.html', 'Escanear']];
  document.querySelector('#nav').innerHTML = `
    <a class="brand" href="/">Inventario IT</a>
    ${links.map(([h, t]) => `<a href="${h}" ${location.pathname === h ? 'aria-current="page"' : ''}>${t}</a>`).join('')}
    <span class="spacer"></span>
    <span class="who">${esc(u.nombre)}</span>
    <button class="link" id="salir">Salir</button>`;
  document.querySelector('#salir').onclick = async () => {
    await API.post('/auth/logout');
    // Borra datos de la API cacheados por la PWA para que otro usuario no los vea
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
    location.href = '/login.html';
  };
  return u;
}

// Registro del service worker (PWA)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
