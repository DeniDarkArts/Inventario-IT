// /api/disponibilidad — equipos libres ahora, tras preparación y próximamente
const router = require('express').Router();
const { query } = require('../db');
const { ah } = require('../lib/http');
const { ambito } = require('../middleware/auth');

router.get('/', ah(async (req, res) => {
  const user = req.session.user;
  const amb = ambito(user);
  if (!amb.todo && !amb.unIds?.length) return res.status(403).json({ error: 'Sin permiso' });

  const where = ["v.disponibilidad <> 'no_disponible'"]; const params = [];
  if (req.query.tipo) { where.push('v.tipo = ?'); params.push(req.query.tipo); }
  if (req.query.ubicacion_id) { where.push('v.ubicacion_id = ?'); params.push(req.query.ubicacion_id); }
  if (req.query.ram_min) {
    where.push("CAST(JSON_UNQUOTE(JSON_EXTRACT(v.specs, '$.ram_gb')) AS UNSIGNED) >= ?");
    params.push(Number(req.query.ram_min));
  }
  const unFiltro = req.query.un_id ? [Number(req.query.un_id)] : (amb.todo ? [] : amb.unIds);
  if (unFiltro.length) {
    where.push(`EXISTS (SELECT 1 FROM equipo_unidades eu WHERE eu.equipo_id = v.id
                 AND eu.un_id IN (${unFiltro.map(() => '?').join(',')}))`);
    params.push(...unFiltro);
  }

  const filas = await query(
    `SELECT v.* FROM v_equipos_disponibilidad v WHERE ${where.join(' AND ')}
      ORDER BY FIELD(v.disponibilidad, 'libre', 'libre_tras_preparacion', 'libre_proximamente'),
               v.libre_desde, v.tipo, v.codigo_interno`, params);

  const agrupado = { libre: [], libre_tras_preparacion: [], libre_proximamente: [] };
  for (const f of filas) agrupado[f.disponibilidad]?.push(f);
  res.json(agrupado);
}));

module.exports = router;
