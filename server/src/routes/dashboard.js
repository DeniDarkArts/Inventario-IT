// /api/dashboard/resumen — KPIs del panel de IT
const router = require('express').Router();
const { query } = require('../db');
const { ah } = require('../lib/http');
const { requireRol } = require('../middleware/auth');
const personas = require('../lib/personas');

router.get('/resumen', requireRol('admin_it', 'tecnico_it', 'lector'), ah(async (req, res) => {
  const [porEstado, disponibilidad, asignados, incidencias, masters] = await Promise.all([
    query('SELECT estado, COUNT(*) AS n FROM equipos GROUP BY estado'),
    query('SELECT disponibilidad, COUNT(*) AS n FROM v_equipos_disponibilidad GROUP BY disponibilidad'),
    // Equipos en manos de una persona: los de quien está de baja en ING039 quedarán libres
    query(`SELECT empleado_id, disponibilidad, con_incidencia FROM v_equipos_disponibilidad
            WHERE empleado_id IS NOT NULL`),
    query(`SELECT prioridad, COUNT(*) AS n FROM incidencias
            WHERE estado IN ('abierta','en_curso','en_reparacion') GROUP BY prioridad`),
    query(`SELECT COUNT(*) AS n FROM masterizaciones WHERE estado NOT IN ('completada','fallida')`),
  ]);

  const disp = Object.fromEntries(disponibilidad.map((r) => [r.disponibilidad, r.n]));
  const mapa = await personas.porIds(asignados.map((a) => a.empleado_id));
  const bajas = new Map();  // persona de baja → nº de equipos por recoger
  for (const a of asignados) {
    const p = mapa.get(a.empleado_id);
    if (!p?.baja) continue;
    bajas.set(p.id, { id: p.id, nombre: p.nombre_completo, bu: p.bu, baja: p.baja, equipos_pendientes: (bajas.get(p.id)?.equipos_pendientes || 0) + 1 });
    if (a.disponibilidad === 'no_disponible' && !a.con_incidencia) {
      disp.no_disponible -= 1;
      disp.libre_proximamente = (disp.libre_proximamente || 0) + 1;
    }
  }

  res.json({
    equipos_por_estado: Object.fromEntries(porEstado.map((r) => [r.estado, r.n])),
    disponibilidad: disp,
    bajas_con_equipos: [...bajas.values()].sort((a, b) => a.baja.localeCompare(b.baja)),
    incidencias_abiertas: Object.fromEntries(incidencias.map((r) => [r.prioridad, r.n])),
    masterizaciones_pendientes: masters[0].n,
  });
}));

module.exports = router;
