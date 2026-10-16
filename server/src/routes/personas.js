// /api/personas — personas de ing039.users (solo lectura) y sus equipos.
// Altas, bajas y cambios de BU u oficina se hacen en ING039, no aquí.
const router = require('express').Router();
const { query } = require('../db');
const { ah, HttpError } = require('../lib/http');
const { ambito, veTodo } = require('../middleware/auth');
const personas = require('../lib/personas');

/** ¿Puede el usuario ver a esta persona? IT/lector todo; responsable su BU; cada uno a sí mismo. */
function puedeVer(user, p) {
  const amb = ambito(user);
  return amb.todo || p.id === user.empleado_id || (amb.bus || []).includes(p.bu);
}

/** Añade a cada persona cuántos equipos tiene asignados ahora. */
async function conEquipos(lista) {
  if (!lista.length) return lista;
  const filas = await query(
    `SELECT empleado_id, COUNT(*) AS n FROM asignaciones
      WHERE fecha_devolucion IS NULL AND empleado_id IN (${lista.map(() => '?').join(',')}) GROUP BY empleado_id`,
    lista.map((p) => p.id));
  const n = new Map(filas.map((f) => [f.empleado_id, f.n]));
  return lista.map((p) => ({ ...p, num_equipos: n.get(p.id) || 0 }));
}

// GET /api/personas?q=texto&bu=SYSTEMS&limit=30 — buscador (asignar equipo, filtros)
router.get('/', ah(async (req, res) => {
  const user = req.session.user;
  const amb = ambito(user);
  if (!amb.todo && !amb.bus?.length) throw new HttpError(403, 'Sin permiso');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const bus = req.query.bu ? [String(req.query.bu)] : (amb.todo ? undefined : amb.bus);
  if (!amb.todo && req.query.bu && !amb.bus.includes(req.query.bu)) throw new HttpError(403, 'Sin permiso');
  const items = await personas.buscar(req.query.q || '', { bus, limit, incluirBajas: req.query.bajas === '1' });
  res.json({ items: await conEquipos(items) });
}));

// GET /api/personas/bajas — personas de baja en ING039 que aún tienen equipos (a recoger)
router.get('/bajas', ah(async (req, res) => {
  if (!veTodo(req.session.user)) throw new HttpError(403, 'Sin permiso');
  const abiertas = await query(
    `SELECT empleado_id, COUNT(*) AS equipos FROM asignaciones
      WHERE fecha_devolucion IS NULL AND empleado_id IS NOT NULL GROUP BY empleado_id`);
  const mapa = await personas.porIds(abiertas.map((a) => a.empleado_id));
  const items = abiertas
    .map((a) => ({ ...mapa.get(a.empleado_id), id: a.empleado_id, equipos: a.equipos }))
    .filter((p) => p.baja)
    .sort((a, b) => String(a.baja).localeCompare(String(b.baja)));
  res.json({ items });
}));

// GET /api/personas/:id
router.get('/:id(\\d+)', ah(async (req, res) => {
  const p = await personas.porId(req.params.id);
  if (!p) throw new HttpError(404, 'Persona no encontrada en ING039');
  if (!puedeVer(req.session.user, p)) throw new HttpError(403, 'Sin permiso');
  res.json((await conEquipos([p]))[0]);
}));

// GET /api/personas/:id/equipos — equipos asignados ahora
router.get('/:id(\\d+)/equipos', ah(async (req, res) => {
  const user = req.session.user;
  const id = Number(req.params.id);
  if (id !== user.empleado_id) {
    const p = await personas.porId(id);
    if (!p || !puedeVer(user, p)) throw new HttpError(403, 'Sin permiso');
  }
  const items = await query(
    `SELECT a.id AS asignacion_id, a.tipo AS tipo_asignacion, a.fecha_inicio, a.fecha_fin_prevista,
            e.id, e.codigo_qr, e.codigo_interno, e.estado, e.num_serie, e.hostname,
            t.nombre AS tipo, m.marca, m.modelo, p.codigo AS proyecto
       FROM asignaciones a
       JOIN equipos e       ON e.id = a.equipo_id
       JOIN tipos_equipo t  ON t.id = e.tipo_id
       LEFT JOIN modelos m  ON m.id = e.modelo_id
       LEFT JOIN proyectos p ON p.id = a.proyecto_id
      WHERE a.empleado_id = ? AND a.fecha_devolucion IS NULL
      ORDER BY t.nombre`, [id]);
  res.json({ items });
}));

module.exports = router;
