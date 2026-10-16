// /api/dashboard/resumen — KPIs del panel de IT
const router = require('express').Router();
const { query } = require('../db');
const { ah } = require('../lib/http');
const { requireRol } = require('../middleware/auth');

router.get('/resumen', requireRol('admin_it', 'tecnico_it'), ah(async (req, res) => {
  const [porEstado, disponibilidad, altas, bajas, incidencias, masters] = await Promise.all([
    query('SELECT estado, COUNT(*) AS n FROM equipos GROUP BY estado'),
    query('SELECT disponibilidad, COUNT(*) AS n FROM v_equipos_disponibilidad GROUP BY disponibilidad'),
    query(`SELECT id, nombre, apellidos, fecha_alta FROM empleados
            WHERE estado = 'pendiente_alta' AND fecha_alta <= DATE_ADD(CURDATE(), INTERVAL 15 DAY) ORDER BY fecha_alta`),
    query(`SELECT e.id, e.nombre, e.apellidos, e.fecha_baja_prevista,
                  (SELECT COUNT(*) FROM asignaciones a WHERE a.empleado_id = e.id AND a.fecha_devolucion IS NULL) AS equipos_pendientes
             FROM empleados e
            WHERE e.estado = 'pendiente_baja' AND e.fecha_baja_prevista <= DATE_ADD(CURDATE(), INTERVAL 15 DAY)
            ORDER BY e.fecha_baja_prevista`),
    query(`SELECT prioridad, COUNT(*) AS n FROM incidencias
            WHERE estado IN ('abierta','en_curso','en_reparacion') GROUP BY prioridad`),
    query(`SELECT COUNT(*) AS n FROM masterizaciones WHERE estado NOT IN ('completada','fallida')`),
  ]);
  res.json({
    equipos_por_estado: Object.fromEntries(porEstado.map((r) => [r.estado, r.n])),
    disponibilidad: Object.fromEntries(disponibilidad.map((r) => [r.disponibilidad, r.n])),
    proximas_altas: altas,
    proximas_bajas: bajas,
    incidencias_abiertas: Object.fromEntries(incidencias.map((r) => [r.prioridad, r.n])),
    masterizaciones_pendientes: masters[0].n,
  });
}));

module.exports = router;
