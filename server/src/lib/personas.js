// Personas, BU, oficinas y bajas: se leen en vivo de ing039.users (solo lectura, nunca se copian).
// El inventario guarda únicamente el Id de ing039 (asignaciones.empleado_id, usuarios.empleado_id...).
// La tabla completa (~2.300 filas) se mantiene en memoria TTL_MS para no consultar ing039 en cada petición.
const { poolAuth } = require('../db');

const TTL_MS = 60 * 1000;
let _cache = null;     // { t, lista, porId }
let _cargando = null;

const limpio = (v) => String(v ?? '').trim();
const _norm = (s) => limpio(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function cargar() {
  if (!poolAuth) return { t: Date.now(), lista: [], porId: new Map() };
  const [cols] = await poolAuth.query("SHOW COLUMNS FROM users LIKE 'Baja'");
  const conBaja = cols.length > 0;
  const [rows] = await poolAuth.query(
    `SELECT Id, User, Resid, Nombre, Apellidos, BU, Site
            ${conBaja ? ", DATE_FORMAT(Baja, '%Y-%m-%d') AS Baja" : ', NULL AS Baja'} FROM users`);

  // Una baja solo cuenta si no hay otro registro activo de la misma persona (mismo Resid o email):
  // ING039 a veces conserva la fila antigua con Baja y crea otra nueva activa.
  const activosResid = new Set(); const activosEmail = new Set();
  for (const r of rows) if (!r.Baja) { activosResid.add(limpio(r.Resid)); activosEmail.add(limpio(r.User).toLowerCase()); }

  const lista = rows.map((r) => {
    const email = limpio(r.User).toLowerCase();
    const resid = limpio(r.Resid);
    const baja = r.Baja && !(resid && activosResid.has(resid)) && !activosEmail.has(email) ? r.Baja : null;
    const nombre = limpio(r.Nombre); const apellidos = limpio(r.Apellidos);
    return {
      id: r.Id, resid, nombre, apellidos, email,
      nombre_completo: [nombre, apellidos].filter(Boolean).join(' ') || email,
      bu: limpio(r.BU) || null, oficina: limpio(r.Site) || null,
      baja,                                // fecha de baja efectiva o null
      registro_antiguo: !!r.Baja && !baja, // fila con Baja de alguien que sigue activo con otra fila
    };
  });
  for (const p of lista) p._texto = _norm(`${p.nombre_completo} ${p.email} ${p.resid}`);
  return { t: Date.now(), lista, porId: new Map(lista.map((p) => [p.id, p])) };
}

/** Datos actuales de ing039 (con caché). */
async function datos() {
  if (_cache && Date.now() - _cache.t < TTL_MS) return _cache;
  if (!_cargando) _cargando = cargar().then((c) => (_cache = c)).finally(() => { _cargando = null; });
  return _cargando;
}

const publica = (p) => (p ? (({ _texto, ...resto }) => resto)(p) : null);

/** Persona por Id de ing039 (o null). */
async function porId(id) { return publica((await datos()).porId.get(Number(id))); }

/** Map Id → persona para una lista de ids (los que no existan no aparecen). */
async function porIds(ids) {
  const { porId: m } = await datos();
  const out = new Map();
  for (const id of new Set(ids.filter(Boolean).map(Number))) if (m.has(id)) out.set(id, publica(m.get(id)));
  return out;
}

/**
 * Busca personas por nombre, email o Resid.
 * opciones: { bus: [...] (limita a esas BU), incluirBajas, limit }
 */
async function buscar(q, { bus, incluirBajas = false, limit = 30 } = {}) {
  const { lista } = await datos();
  const palabras = _norm(q).split(/\s+/).filter(Boolean);
  const out = [];
  for (const p of lista) {
    if (p.registro_antiguo) continue;
    if (!incluirBajas && p.baja) continue;
    if (bus && !bus.includes(p.bu)) continue;
    if (palabras.length && !palabras.every((w) => p._texto.includes(w))) continue;
    out.push(publica(p));
  }
  out.sort((a, b) => a.apellidos.localeCompare(b.apellidos, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
  return out.slice(0, limit);
}

/** Ids de las personas cuyo nombre, email o Resid contiene el texto (para filtrar equipos por persona). */
async function idsQueCoinciden(q) { return (await buscar(q, { incluirBajas: true, limit: 500 })).map((p) => p.id); }

/** BU existentes (de personas activas), ordenadas. */
async function bus() {
  const { lista } = await datos();
  return [...new Set(lista.filter((p) => !p.baja && p.bu).map((p) => p.bu))].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Oficinas (Site) existentes, de personas activas, ordenadas. */
async function oficinas() {
  const { lista } = await datos();
  return [...new Set(lista.filter((p) => !p.baja && p.oficina).map((p) => p.oficina))].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Fuerza recargar en la siguiente consulta (tras un login, por ejemplo). */
function invalidar() { _cache = null; }

/** Nombre para mostrar de un Id (persona desconocida si ya no está en ing039). */
const nombreDe = (mapa, id) => (id ? mapa.get(Number(id))?.nombre_completo ?? `Persona desconocida (#${id})` : null);

module.exports = { porId, porIds, buscar, idsQueCoinciden, bus, oficinas, invalidar, nombreDe };
