// /api/masterizaciones — cola de trabajo de IT
const router = require('express').Router();
const { query, transaction } = require('../db');
const { ah, HttpError } = require('../lib/http');
const { auditar } = require('../lib/auditoria');
const { requireRol } = require('../middleware/auth');

const IT = ['admin_it', 'tecnico_it'];
router.use(requireRol(...IT));

router.get('/', ah(async (req, res) => {
  const where = ['1=1']; const params = [];
  if (req.query.estado) { where.push('m.estado = ?'); params.push(req.query.estado); }
  else where.push("m.estado NOT IN ('completada','fallida')");
  const items = await query(
    `SELECT m.*, e.codigo_interno, e.hostname, c.nombre AS cliente,
            DATEDIFF(NOW(), COALESCE(m.fecha_envio, m.fecha_solicitud)) AS dias
       FROM masterizaciones m
       JOIN equipos e ON e.id = m.equipo_id
       LEFT JOIN clientes c ON c.id = m.cliente_id
      WHERE ${where.join(' AND ')} ORDER BY m.fecha_solicitud`, params);
  res.json({ items });
}));

router.post('/', ah(async (req, res) => {
  const b = req.body || {};
  if (!b.equipo_id || !['interna', 'cliente'].includes(b.tipo)) throw new HttpError(400, 'equipo_id y tipo (interna|cliente) obligatorios');
  const id = await transaction(async (conn) => {
    const [r] = await conn.execute(
      'INSERT INTO masterizaciones (equipo_id, tipo, cliente_id, dominio, imagen_version, notas) VALUES (?, ?, ?, ?, ?, ?)',
      [b.equipo_id, b.tipo, b.cliente_id || null, b.dominio || null, b.imagen_version || null, b.notas || null]);
    await conn.execute(
      "UPDATE equipos SET estado_previo = estado, estado = 'pendiente_master' WHERE id = ? AND estado IN ('en_stock','reservado','en_revision')",
      [b.equipo_id]);
    await auditar(conn, req, 'masterizacion', r.insertId, 'solicitar', null, b);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

/** PATCH: avanzar estado. Al completar, se guarda hostname/dominio y el equipo vuelve a su estado. */
router.patch('/:id(\\d+)', ah(async (req, res) => {
  const b = req.body || {};
  const validos = ['pendiente', 'en_curso', 'enviado_cliente', 'completada', 'fallida'];
  if (b.estado && !validos.includes(b.estado)) throw new HttpError(400, 'Estado no válido');
  await transaction(async (conn) => {
    const [[m]] = await conn.execute('SELECT * FROM masterizaciones WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!m) throw new HttpError(404, 'Masterización no encontrada');
    await conn.execute(
      `UPDATE masterizaciones SET estado = COALESCE(?, estado), dominio = COALESCE(?, dominio),
         imagen_version = COALESCE(?, imagen_version), notas = COALESCE(?, notas), tecnico_id = ?,
         fecha_envio = IF(? = 'enviado_cliente', NOW(), fecha_envio),
         fecha_completada = IF(? = 'completada', NOW(), fecha_completada)
       WHERE id = ?`,
      [b.estado || null, b.dominio || null, b.imagen_version || null, b.notas || null, req.session.user.id,
       b.estado || '', b.estado || '', m.id]);
    if (b.estado === 'completada') {
      if (b.hostname) await conn.execute('UPDATE equipos SET hostname = ? WHERE id = ?', [b.hostname, m.equipo_id]);
      // Sale de pendiente_master: si ya tenía asignación abierta vuelve a 'asignado', si no a 'en_stock'
      await conn.execute(
        `UPDATE equipos e SET e.estado = IF(EXISTS (SELECT 1 FROM asignaciones a WHERE a.equipo_id = e.id AND a.fecha_devolucion IS NULL),
                                           'asignado', 'en_stock'), e.estado_previo = NULL
          WHERE e.id = ? AND e.estado = 'pendiente_master'`, [m.equipo_id]);
    }
    await auditar(conn, req, 'masterizacion', m.id, 'actualizar', m, b);
  });
  res.json({ ok: true });
}));

module.exports = router;
