// /api/disponibilidad — equipos libres ahora, tras preparación y próximamente
// "Próximamente" incluye los equipos de personas que están de baja en ING039 (users.Baja), leídas en vivo.
const router = require('express').Router();
const { query } = require('../db');
const { ah } = require('../lib/http');
const { ambito } = require('../middleware/auth');
const personas = require('../lib/personas');

router.get('/', ah(async (req, res) => {
  const user = req.session.user;
  const amb = ambito(user);
  if (!amb.todo && !amb.bus?.length) return res.status(403).json({ error: 'Sin permiso' });

  // Además de los disponibles, los asignados a una persona: pueden quedar libres si está de baja
  const where = ["(v.disponibilidad <> 'no_disponible' OR (v.empleado_id IS NOT NULL AND NOT v.con_incidencia))"];
  const params = [];
  if (req.query.tipo) { where.push('v.tipo = ?'); params.push(req.query.tipo); }
  if (req.query.ubicacion_id) { where.push('v.ubicacion_id = ?'); params.push(req.query.ubicacion_id); }
  if (req.query.ram_min) {
    where.push("CAST(JSON_UNQUOTE(JSON_EXTRACT(v.specs, '$.ram_gb')) AS UNSIGNED) >= ?");
    params.push(Number(req.query.ram_min));
  }
  const buFiltro = req.query.bu ? [String(req.query.bu)] : (amb.todo ? [] : amb.bus);
  if (buFiltro.length) {
    where.push(`EXISTS (SELECT 1 FROM equipo_unidades eu WHERE eu.equipo_id = v.id
                 AND eu.bu IN (${buFiltro.map(() => '?').join(',')}))`);
    params.push(...buFiltro);
  }

  const filas = await query(`SELECT v.* FROM v_equipos_disponibilidad v WHERE ${where.join(' AND ')}`, params);
  const mapa = await personas.porIds(filas.map((f) => f.empleado_id));

  const agrupado = { libre: [], libre_tras_preparacion: [], libre_proximamente: [] };
  for (const f of filas) {
    const p = mapa.get(f.empleado_id);
    f.asignado_a = personas.nombreDe(mapa, f.empleado_id);
    f.asignado_baja = p?.baja || null;
    if (p?.baja) {
      // Libre cuando se recoja: la fecha más temprana entre la baja y el fin previsto
      f.disponibilidad = 'libre_proximamente';
      f.libre_desde = [p.baja, f.libre_desde].filter(Boolean).sort()[0];
      f.motivo = 'baja';
    } else if (f.disponibilidad === 'libre_proximamente') {
      f.motivo = 'fin_previsto';
    }
    agrupado[f.disponibilidad]?.push(f);
  }
  const porFecha = (a, b) => String(a.libre_desde || '9999').localeCompare(String(b.libre_desde || '9999'))
    || a.tipo.localeCompare(b.tipo, 'es') || a.codigo_interno.localeCompare(b.codigo_interno);
  for (const k of Object.keys(agrupado)) agrupado[k].sort(porFecha);
  res.json(agrupado);
}));

module.exports = router;
