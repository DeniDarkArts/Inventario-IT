// /api/incidencias — reportar (con fotos), gestionar y resolver
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query, transaction } = require('../db');
const { ah, HttpError } = require('../lib/http');
const { auditar } = require('../lib/auditoria');
const { requireRol, esIT } = require('../middleware/auth');

const IT = ['admin_it', 'tecnico_it'];
const UPLOAD_DIR = path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || '../uploads', 'incidencias');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => cb(null, /^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(file.mimetype)),
});

router.get('/', ah(async (req, res) => {
  const user = req.session.user;
  const where = ['1=1']; const params = [];
  if (!esIT(user)) { where.push('i.reportada_por = ?'); params.push(user.id); }
  if (req.query.estado) { where.push('i.estado = ?'); params.push(req.query.estado); }
  if (req.query.abiertas) where.push("i.estado IN ('abierta','en_curso','en_reparacion')");
  const items = await query(
    `SELECT i.*, e.codigo_interno, t.nombre AS tipo_equipo, u.email AS reportada_por_email
       FROM incidencias i
       JOIN equipos e ON e.id = i.equipo_id
       JOIN tipos_equipo t ON t.id = e.tipo_id
       JOIN usuarios u ON u.id = i.reportada_por
      WHERE ${where.join(' AND ')}
      ORDER BY FIELD(i.prioridad, 'critica', 'alta', 'media', 'baja'), i.fecha_apertura DESC
      LIMIT 500`, params);
  res.json({ items });
}));

// POST multipart: equipo_id, categoria, descripcion, fotos[]
router.post('/', upload.array('fotos', 5), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.equipo_id || !b.categoria || !b.descripcion) throw new HttpError(400, 'equipo_id, categoria y descripcion son obligatorios');
  const user = req.session.user;

  // Un empleado solo puede reportar sobre sus equipos asignados
  if (!esIT(user)) {
    const [mio] = await query(
      'SELECT 1 FROM asignaciones WHERE equipo_id = ? AND empleado_id = ? AND fecha_devolucion IS NULL',
      [b.equipo_id, user.empleado_id ?? -1]);
    if (!mio) throw new HttpError(403, 'Solo puedes reportar incidencias de tus equipos');
  }

  const id = await transaction(async (conn) => {
    const [r] = await conn.execute(
      'INSERT INTO incidencias (equipo_id, reportada_por, categoria, prioridad, descripcion) VALUES (?, ?, ?, ?, ?)',
      [b.equipo_id, user.id, b.categoria, esIT(user) && b.prioridad ? b.prioridad : 'media', b.descripcion]);
    for (const f of req.files || []) {
      await conn.execute('INSERT INTO incidencia_adjuntos (incidencia_id, ruta, tipo, subido_por) VALUES (?, ?, ?, ?)',
        [r.insertId, `incidencias/${f.filename}`, f.mimetype, user.id]);
    }
    // Pérdida o robo: cierra la asignación y marca el equipo
    if (b.categoria === 'perdida_robo') {
      await conn.execute("UPDATE asignaciones SET fecha_devolucion = CURDATE(), notas = CONCAT_WS('\\n', notas, 'Pérdida o robo') WHERE equipo_id = ? AND fecha_devolucion IS NULL", [b.equipo_id]);
      await conn.execute("UPDATE equipos SET estado_previo = estado, estado = 'perdido' WHERE id = ?", [b.equipo_id]);
    }
    await auditar(conn, req, 'incidencia', r.insertId, 'abrir', null, { ...b, fotos: (req.files || []).length });
    return r.insertId;
  });
  res.status(201).json({ id });
}));

/**
 * PATCH /api/incidencias/:id — IT: prioridad, estado, técnico, sustituto, resolución
 * estado 'en_reparacion' → equipo a en_reparacion
 * estado 'resuelta'      → equipo vuelve a su estado previo
 */
router.patch('/:id(\\d+)', requireRol(...IT), ah(async (req, res) => {
  const b = req.body || {};
  await transaction(async (conn) => {
    const [[inc]] = await conn.execute('SELECT * FROM incidencias WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!inc) throw new HttpError(404, 'Incidencia no encontrada');
    const campos = ['prioridad', 'estado', 'resolucion', 'equipo_sustituto_id', 'tecnico_id'].filter((c) => c in b);
    if (campos.length) {
      await conn.execute(`UPDATE incidencias SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...campos.map((c) => b[c] ?? null), inc.id]);
    }
    if (b.estado === 'en_reparacion') {
      await conn.execute(
        `UPDATE equipos SET estado_previo = estado, estado = 'en_reparacion',
           ubicacion_id = (SELECT id FROM ubicaciones WHERE tipo = 'reparacion' LIMIT 1)
         WHERE id = ? AND estado <> 'en_reparacion'`, [inc.equipo_id]);
    }
    if (b.estado === 'resuelta' || b.estado === 'cerrada') {
      await conn.execute('UPDATE incidencias SET fecha_cierre = NOW() WHERE id = ?', [inc.id]);
      await conn.execute(
        `UPDATE equipos SET estado = COALESCE(estado_previo, 'en_revision'), estado_previo = NULL
          WHERE id = ? AND estado = 'en_reparacion'`, [inc.equipo_id]);
    }
    await auditar(conn, req, 'incidencia', inc.id, 'actualizar', inc, b);
  });
  res.json({ ok: true });
}));

module.exports = router;
