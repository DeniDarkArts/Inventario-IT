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
const veTodo = (u) => esIT(u) || tieneRol(u, 'lector');

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

/** Texto de una BU. */
const nombreBU = (x) => x.codigo;  // BU de ING039: el nombre es el propio código (p. ej. SYSTEMS)

/** Sitio físico de un equipo: "Cliente Aero A — Getafe · Edificio B · Puesto 2.14". */
const textoUbicacion = (e) => [e.ubicacion, e.edificio && `Edificio ${e.edificio}`, e.puesto && `Puesto ${e.puesto}`].filter(Boolean).join(' · ');

/**
 * Opciones de un <select> de ubicaciones agrupadas por tipo. Las oficinas son el Site de ING039
 * (valor "o:<nombre>"); clientes, almacén y reparación son ubicaciones del inventario (valor "u:<id>").
 */
function opcionesUbicacion(items, oficinas = [], tipos = ['oficina', 'cliente', 'almacen', 'reparacion']) {
  const NOMBRE = { oficina: 'Oficinas', cliente: 'Clientes', almacen: 'Almacén', reparacion: 'Reparación' };
  return '<option value="">—</option>' + tipos.map((t) => {
    const ops = t === 'oficina'
      ? oficinas.map((o) => `<option value="o:${esc(o.nombre)}">${esc(o.nombre)}</option>`)
      : items.filter((x) => x.tipo === t && x.activa !== 0).map((x) => `<option value="u:${x.id}">${esc(x.nombre)}</option>`);
    return ops.length ? `<optgroup label="${NOMBRE[t]}">${ops.join('')}</optgroup>` : '';
  }).join('');
}
/** Valor del <select> de ubicaciones → { ubicacion_id, oficina } para la API. */
const leerUbicacion = (v) => ({
  ubicacion_id: v?.startsWith('u:') ? Number(v.slice(2)) : null,
  oficina: v?.startsWith('o:') ? v.slice(2) : null,
});
/** Valor del <select> que corresponde al sitio actual de un equipo (o de una persona: oficina). */
const valorUbicacion = (e) => (e.ubicacion_id ? `u:${e.ubicacion_id}` : e.oficina ? `o:${e.oficina}` : '');

/** Nombre de quien tiene el equipo, marcando si está de baja en ING039. */
const textoAsignado = (e) => (e.asignado_a ? `${e.asignado_a}${e.asignado_baja ? ` (baja ${e.asignado_baja})` : ''}` : '—');

const ETIQUETA_ROL = {
  admin_it: 'Administrador IT', tecnico_it: 'Técnico IT', lector: 'Lector', responsable: 'Responsable', empleado: 'Empleado',
};

/** Pinta la cabecera y el menú según el rol. */
async function nav() {
  const u = await me();
  const links = veTodo(u)
    ? [['/', 'Inventario'], ['/disponibilidad.html', 'Disponibilidad'], ['/escanear.html', 'Escanear'], ['/mis-equipos.html', 'Mis equipos']]
    : tieneRol(u, 'responsable')
      ? [['/disponibilidad.html', 'Disponibilidad'], ['/mis-equipos.html', 'Mis equipos'], ['/escanear.html', 'Escanear']]
      : [['/mis-equipos.html', 'Mis equipos'], ['/escanear.html', 'Escanear']];
  const rol = ETIQUETA_ROL[u.roles[0]?.rol] || 'Empleado';
  document.querySelector('#nav').innerHTML = `
    <header>
      <div class="sesion">
        <button class="primary" id="salir">Salir</button>
        <span class="who">${esc(u.email)}</span>
        <span class="rol">(${esc(rol)})</span>
      </div>
      <a class="marca" href="/">
        <img src="/icons/logo-ct.jpg" alt="CT Ingenieros">
        <span>CT Ingenieros<small>Inventario IT</small></span>
      </a>
    </header>
    <nav>${links.map(([h, t]) => `<a href="${h}" ${location.pathname === h ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
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
