// /api/empleados — altas, bajas, equipos asignados
const router = require('express').Router();
const { query, transaction } = require('../db');
const { ah, HttpError, paginacion } = require('../lib/http');
const { auditar } = require('../lib/auditoria');
const { requireRol, esIT, ambito } = require('../middleware/auth');

const IT = ['admin_it', 'tecnico_it'];

router.get('/', ah(async (req, res) => {
  const user = req.session.user;
  const amb = ambito(user);
  const { limit, offset, page } = paginacion(req);
  const where = ['1=1']; const params = [];
  if (!amb.todo) {
    if (!amb.unIds?.length && !amb.proyectoIds?.length) return res.status(403).json({ error: 'Sin permiso' });
    const partes = [];
    if (amb.unIds.length) { partes.push(`e.un_id IN (${amb.unIds.map(() => '?').join(',')})`); params.push(...amb.unIds); }
    if (amb.proyectoIds.length) { partes.push(`e.proyecto_actual_id IN (${amb.proyectoIds.map(() => '?').join(',')})`); params.push(...amb.proyectoIds); }
    where.push(`(${partes.join(' OR ')})`);
  }
  if (req.query.q) {
    where.push("(e.num_empleado LIKE ? OR e.email LIKE ? OR CONCAT(e.nombre, ' ', e.apellidos) LIKE ?)");
    params.push(...Array(3).fill(`%${req.query.q}%`));
  }
  if (req.query.estado) { where.push('e.estado = ?'); params.push(req.query.estado); }
  if (req.query.un_id) { where.push('e.un_id = ?'); params.push(req.query.un_id); }

  const items = await query(
    `SELECT e.*, un.codigo AS un, p.codigo AS proyecto, ub.nombre AS ubicacion,
            (SELECT COUNT(*) FROM asignaciones a WHERE a.empleado_id = e.id AND a.fecha_devolucion IS NULL) AS num_equipos
       FROM empleados e
       JOIN unidades_negocio un ON un.id = e.un_id
       LEFT JOIN proyectos p    ON p.id = e.proyecto_actual_id
       LEFT JOIN ubicaciones ub ON ub.id = e.ubicacion_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.apellidos, e.nombre LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ items, page, limit });
}));

router.post('/', requireRol(...IT), ah(async (req, res) => {
  const b = req.body || {};
  for (const c of ['num_empleado', 'nombre', 'apellidos', 'email', 'un_id', 'fecha_alta']) {
    if (!b[c]) throw new HttpError(400, `${c} es obligatorio`);
  }
  const id = await transaction(async (conn) => {
    const [r] = await conn.execute(
      `INSERT INTO empleados (num_empleado, nombre, apellidos, email, un_id, proyecto_actual_id, ubicacion_id, fecha_alta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.num_empleado, b.nombre, b.apellidos, b.email.toLowerCase(), b.un_id,
       b.proyecto_actual_id || null, b.ubicacion_id || null, b.fecha_alta]);
    await auditar(conn, req, 'empleado', r.insertId, 'alta', null, b);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

const EDITABLES = ['nombre', 'apellidos', 'email', 'un_id', 'proyecto_actual_id', 'ubicacion_id', 'fecha_alta', 'fecha_baja_prevista'];
router.patch('/:id(\\d+)', requireRol(...IT), ah(async (req, res) => {
  const campos = Object.keys(req.body || {}).filter((k) => EDITABLES.includes(k));
  if (!campos.length) throw new HttpError(400, 'Nada que actualizar');
  await transaction(async (conn) => {
    const [[antes]] = await conn.execute('SELECT * FROM empleados WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!antes) throw new HttpError(404, 'Empleado no encontrado');
    await conn.execute(`UPDATE empleados SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...campos.map((c) => req.body[c] ?? null), req.params.id]);
    // Fijar fecha de baja prevista activa la recogida de equipos
    if (req.body.fecha_baja_prevista && antes.estado === 'activo') {
      await conn.execute("UPDATE empleados SET estado = 'pendiente_baja' WHERE id = ?", [req.params.id]);
    }
    await auditar(conn, req, 'empleado', Number(req.params.id), 'editar', antes, req.body);
  });
  res.json({ ok: true });
}));

router.get('/:id(\\d+)/equipos', ah(async (req, res) => {
  const user = req.session.user;
  if (!esIT(user) && Number(req.params.id) !== user.empleado_id && !ambito(user).unIds?.length) {
    return res.status(403).json({ error: 'Sin permiso' });
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
      ORDER BY t.nombre`, [req.params.id]);
  res.json({ items });
}));

router.post('/:id(\\d+)/baja', requireRol(...IT), ah(async (req, res) => {
  await transaction(async (conn) => {
    const [[pend]] = await conn.execute(
      'SELECT COUNT(*) AS n FROM asignaciones WHERE empleado_id = ? AND fecha_devolucion IS NULL', [req.params.id]);
    if (pend.n) throw new HttpError(409, `El empleado aún tiene ${pend.n} equipo(s) sin devolver`);
    await conn.execute("UPDATE empleados SET estado = 'baja', fecha_baja = CURDATE() WHERE id = ?", [req.params.id]);
    await conn.execute('UPDATE usuarios SET activo = 0 WHERE empleado_id = ?', [req.params.id]);
    await auditar(conn, req, 'empleado', Number(req.params.id), 'baja');
  });
  res.json({ ok: true });
}));

module.exports = router;
