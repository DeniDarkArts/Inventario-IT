// /api/equipos — alta, ficha, búsqueda por QR, historial y cambios de estado
const router = require('express').Router();
const { query, transaction } = require('../db');
const { ah, HttpError, paginacion } = require('../lib/http');
const { auditar } = require('../lib/auditoria');
const { validarTransicion, ESTADOS } = require('../lib/estados');
const { requireRol, esIT, veTodo, ambito } = require('../middleware/auth');
const personas = require('../lib/personas');

const IT = ['admin_it', 'tecnico_it'];

const SELECT_EQUIPO = `
  SELECT e.*, t.nombre AS tipo, t.lleva_qr, m.marca, m.modelo, m.specs,
         COALESCE(ub.nombre, e.oficina) AS ubicacion, IF(ub.id IS NULL AND e.oficina IS NOT NULL, 'oficina', ub.tipo) AS ubicacion_tipo,
         a.id AS asignacion_id, a.empleado_id, a.proyecto_id, a.fecha_inicio, a.fecha_fin_prevista,
         p.codigo AS proyecto_codigo, p.nombre AS proyecto
    FROM equipos e
    JOIN tipos_equipo t      ON t.id = e.tipo_id
    LEFT JOIN modelos m      ON m.id = e.modelo_id
    LEFT JOIN ubicaciones ub ON ub.id = e.ubicacion_id
    LEFT JOIN asignaciones a ON a.equipo_id = e.id AND a.fecha_devolucion IS NULL
    LEFT JOIN proyectos p    ON p.id = a.proyecto_id`;

/** Añade a cada equipo el nombre (y la baja, si la hay) de la persona que lo tiene, leídos de ing039. */
async function conPersonas(equipos) {
  const mapa = await personas.porIds(equipos.map((e) => e.empleado_id));
  for (const e of equipos) {
    e.asignado_a = personas.nombreDe(mapa, e.empleado_id);
    e.asignado_baja = mapa.get(e.empleado_id)?.baja || null;
  }
  return equipos;
}

/** Añade al WHERE el filtro de ámbito del usuario (responsable/empleado). */
function filtroAmbito(user, where, params) {
  const amb = ambito(user);
  if (amb.todo) return;
  if (amb.bus?.length || amb.proyectoIds?.length) {
    const partes = [];
    if (amb.bus.length) {
      partes.push(`EXISTS (SELECT 1 FROM equipo_unidades eu WHERE eu.equipo_id = e.id
                   AND eu.bu IN (${amb.bus.map(() => '?').join(',')}))`);
      params.push(...amb.bus);
    }
    if (amb.proyectoIds.length) {
      partes.push(`a.proyecto_id IN (${amb.proyectoIds.map(() => '?').join(',')})`);
      params.push(...amb.proyectoIds);
    }
    where.push(`(${partes.join(' OR ')})`);
    return;
  }
  where.push('a.empleado_id = ?');
  params.push(amb.empleadoId ?? -1);
}

async function fichaCompleta(equipo) {
  await conPersonas([equipo]);
  equipo.unidades = await query(
    `SELECT eu.bu AS codigo, eu.bu AS nombre, eu.principal, eu.porcentaje
       FROM equipo_unidades eu WHERE eu.equipo_id = ? ORDER BY eu.principal DESC`, [equipo.id]);
  const [master] = await query(
    `SELECT tipo, dominio, imagen_version, fecha_completada FROM masterizaciones
      WHERE equipo_id = ? AND estado = 'completada' ORDER BY fecha_completada DESC LIMIT 1`, [equipo.id]);
  equipo.master_actual = master || null;
  equipo.incidencias_abiertas = await query(
    `SELECT id, categoria, prioridad, estado, fecha_apertura FROM incidencias
      WHERE equipo_id = ? AND estado IN ('abierta','en_curso','en_reparacion')`, [equipo.id]);
  equipo.accesorios = await query(
    `SELECT e.id, e.codigo_interno, t.nombre AS tipo FROM equipos e
       JOIN tipos_equipo t ON t.id = e.tipo_id WHERE e.equipo_padre_id = ?`, [equipo.id]);
  return equipo;
}

/** Extrae el código de una URL de QR (…/q/CT-000123) o lo devuelve tal cual. */
function normalizarCodigo(raw) {
  const s = decodeURIComponent(String(raw)).trim();
  // Etiquetas CT: el QR lleva la URL del sistema de activos (…/asset.aspx?AssetID=15967); el código es el AssetID
  const asset = s.match(/[?&]AssetID=(\d+)/i);
  if (asset) return asset[1];
  const m = s.match(/\/q\/([^/?#]+)/);
  return (m ? m[1] : s).toUpperCase();
}

// GET /api/equipos/qr/:codigo — ruta central de la PWA
router.get('/qr/:codigo', ah(async (req, res) => {
  const codigo = normalizarCodigo(req.params.codigo);
  const where = ['(e.codigo_qr = ? OR e.codigo_interno = ?)'];
  const params = [codigo, codigo];
  const [equipo] = await query(`${SELECT_EQUIPO} WHERE ${where.join(' AND ')}`, params);
  if (!equipo) return res.status(404).json({ error: 'Equipo no registrado', codigo, puede_dar_alta: esIT(req.session.user) });

  // Empleados y responsables solo ven equipos de su ámbito
  if (!veTodo(req.session.user)) {
    const w = ['e.id = ?']; const p = [equipo.id];
    filtroAmbito(req.session.user, w, p);
    const [visible] = await query(`${SELECT_EQUIPO} WHERE ${w.join(' AND ')}`, p);
    if (!visible) return res.status(403).json({ error: 'Este equipo no está en tu ámbito' });
  }
  res.json(await fichaCompleta(equipo));
}));

// GET /api/equipos — listado con filtros
router.get('/', ah(async (req, res) => {
  const { limit, offset, page } = paginacion(req);
  const where = ['1=1']; const params = [];
  const f = req.query;
  if (f.q) {
    // La persona se busca en ing039 y se filtra por sus Id
    const ids = await personas.idsQueCoinciden(f.q);
    where.push(`(e.codigo_qr LIKE ? OR e.codigo_interno LIKE ? OR e.num_serie LIKE ? OR e.hostname LIKE ? OR e.orden_compra LIKE ?
                 ${ids.length ? `OR a.empleado_id IN (${ids.map(() => '?').join(',')})` : ''})`);
    params.push(...Array(5).fill(`%${f.q}%`), ...ids);
  }
  if (f.estado)       { where.push('e.estado = ?');       params.push(f.estado); }
  if (f.tipo_id)      { where.push('e.tipo_id = ?');      params.push(f.tipo_id); }
  if (f.ubicacion_id) { where.push('e.ubicacion_id = ?'); params.push(f.ubicacion_id); }
  if (f.oficina)      { where.push('e.oficina = ?');      params.push(f.oficina); }
  if (f.proyecto_id)  { where.push('a.proyecto_id = ?');  params.push(f.proyecto_id); }
  if (f.empleado_id)  { where.push('a.empleado_id = ?');  params.push(f.empleado_id); }
  if (f.bu) {
    where.push('EXISTS (SELECT 1 FROM equipo_unidades eu WHERE eu.equipo_id = e.id AND eu.bu = ?)');
    params.push(f.bu);
  }
  filtroAmbito(req.session.user, where, params);

  const sqlWhere = where.join(' AND ');
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM equipos e
       LEFT JOIN asignaciones a ON a.equipo_id = e.id AND a.fecha_devolucion IS NULL
      WHERE ${sqlWhere}`, params);
  // LIMIT/OFFSET van interpolados (enteros validados): execute() no los admite como parámetros
  const items = await conPersonas(
    await query(`${SELECT_EQUIPO} WHERE ${sqlWhere} ORDER BY e.codigo_interno LIMIT ${limit} OFFSET ${offset}`, params));
  res.json({ items, total, page, limit });
}));

// GET /api/equipos/:id
router.get('/:id(\\d+)', ah(async (req, res) => {
  const where = ['e.id = ?']; const params = [req.params.id];
  filtroAmbito(req.session.user, where, params);
  const [equipo] = await query(`${SELECT_EQUIPO} WHERE ${where.join(' AND ')}`, params);
  if (!equipo) throw new HttpError(404, 'Equipo no encontrado');
  res.json(await fichaCompleta(equipo));
}));

/** Texto opcional recortado: '' o espacios → NULL. */
const texto = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

/** BU del equipo: [{ bu, principal, porcentaje }] con el nombre de la BU de ing039. */
const leerUnidades = (lista) => (Array.isArray(lista) ? lista : [])
  .map((u) => ({ bu: texto(u.bu, 80), principal: !!u.principal, porcentaje: u.porcentaje ?? null }))
  .filter((u) => u.bu);

// POST /api/equipos — alta (normalmente tras escanear un QR nuevo)
router.post('/', requireRol(...IT), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.tipo_id) throw new HttpError(400, 'tipo_id es obligatorio');
  const unidades = leerUnidades(b.unidades);  // [{bu, principal, porcentaje}]
  if (!unidades.length) throw new HttpError(400, 'Indica al menos una BU');

  const id = await transaction(async (conn) => {
    const [[tipo]] = await conn.execute('SELECT prefijo, lleva_qr FROM tipos_equipo WHERE id = ?', [b.tipo_id]);
    if (!tipo) throw new HttpError(400, 'Tipo de equipo no válido');
    const codigoQr = b.codigo_qr ? normalizarCodigo(b.codigo_qr) : null;
    if (tipo.lleva_qr && !codigoQr) throw new HttpError(400, 'Este tipo de equipo requiere código QR');

    const [r] = await conn.execute(
      `INSERT INTO equipos (codigo_qr, codigo_interno, tipo_id, modelo_id, num_serie, hostname, estado,
         ubicacion_id, oficina, edificio, puesto, equipo_padre_id, fecha_compra, proveedor, orden_compra, garantia_hasta, coste,
         observaciones, propiedad)
       VALUES (?, 'TMP', ?, ?, ?, ?, 'en_stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [codigoQr, b.tipo_id, b.modelo_id || null, b.num_serie || null, b.hostname || null,
       b.ubicacion_id || null, b.ubicacion_id ? null : texto(b.oficina, 80), texto(b.edificio, 60), texto(b.puesto, 40), b.equipo_padre_id || null,
       b.fecha_compra || null, b.proveedor || null, texto(b.orden_compra, 40),
       b.garantia_hasta || null, b.coste || null, b.observaciones || null, b.propiedad || 'empresa']);
    // Código interno: el QR si lo hay; si no, PREFIJO-000123
    const codigoInterno = codigoQr || `${tipo.prefijo}-${String(r.insertId).padStart(6, '0')}`;
    await conn.execute('UPDATE equipos SET codigo_interno = ? WHERE id = ?', [codigoInterno, r.insertId]);

    // Recuerda el código de producto leído de la etiqueta para proponer el modelo la próxima vez
    const codigoProducto = String(b.codigo_producto || '').trim().toUpperCase();
    if (codigoProducto && b.modelo_id) {
      await conn.execute(
        'INSERT INTO modelo_codigos (codigo, modelo_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE modelo_id = VALUES(modelo_id)',
        [codigoProducto.slice(0, 40), b.modelo_id]);
    }

    for (const u of unidades) {
      await conn.execute('INSERT INTO equipo_unidades (equipo_id, bu, principal, porcentaje) VALUES (?, ?, ?, ?)',
        [r.insertId, u.bu, u.principal ? 1 : 0, u.porcentaje ?? null]);
    }
    await auditar(conn, req, 'equipo', r.insertId, 'crear', null, { ...b, codigo_interno: codigoInterno });
    return r.insertId;
  });
  res.status(201).json({ id });
}));

// PATCH /api/equipos/:id — datos descriptivos (no estado ni asignación)
const EDITABLES = ['modelo_id', 'num_serie', 'hostname', 'ubicacion_id', 'oficina', 'edificio', 'puesto', 'equipo_padre_id', 'fecha_compra',
  'proveedor', 'orden_compra', 'garantia_hasta', 'coste', 'observaciones', 'propiedad'];
router.patch('/:id(\\d+)', requireRol(...IT), ah(async (req, res) => {
  const campos = Object.keys(req.body || {}).filter((k) => EDITABLES.includes(k));
  if (!campos.length && !req.body?.unidades) throw new HttpError(400, 'Nada que actualizar');
  await transaction(async (conn) => {
    const [[antes]] = await conn.execute('SELECT * FROM equipos WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!antes) throw new HttpError(404, 'Equipo no encontrado');
    if (campos.length) {
      await conn.execute(`UPDATE equipos SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...campos.map((c) => req.body[c] ?? null), req.params.id]);
    }
    if (Array.isArray(req.body.unidades)) {
      await conn.execute('DELETE FROM equipo_unidades WHERE equipo_id = ?', [req.params.id]);
      for (const u of leerUnidades(req.body.unidades)) {
        await conn.execute('INSERT INTO equipo_unidades (equipo_id, bu, principal, porcentaje) VALUES (?, ?, ?, ?)',
          [req.params.id, u.bu, u.principal ? 1 : 0, u.porcentaje]);
      }
    }
    await auditar(conn, req, 'equipo', Number(req.params.id), 'editar', antes, req.body);
  });
  res.json({ ok: true });
}));

// POST /api/equipos/:id/estado — cambio de estado validado
router.post('/:id(\\d+)/estado', requireRol(...IT), ah(async (req, res) => {
  const { estado, motivo } = req.body || {};
  if (!ESTADOS.includes(estado)) throw new HttpError(400, 'Estado no válido');
  await transaction(async (conn) => {
    const [[eq]] = await conn.execute('SELECT id, estado FROM equipos WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!eq) throw new HttpError(404, 'Equipo no encontrado');
    validarTransicion(eq.estado, estado);
    if (estado === 'asignado') throw new HttpError(400, 'Para asignar usa POST /api/asignaciones');
    await conn.execute('UPDATE equipos SET estado = ?, estado_previo = ? WHERE id = ?', [estado, eq.estado, eq.id]);
    await auditar(conn, req, 'equipo', eq.id, 'cambiar_estado', { estado: eq.estado }, { estado, motivo });
  });
  res.json({ ok: true });
}));

// GET /api/equipos/:id/historial
router.get('/:id(\\d+)/historial', ah(async (req, res) => {
  const id = req.params.id;
  const [asignaciones, masterizaciones, incidencias, auditoria] = await Promise.all([
    query(`SELECT a.*, p.codigo AS proyecto
             FROM asignaciones a LEFT JOIN proyectos p ON p.id = a.proyecto_id
            WHERE a.equipo_id = ? ORDER BY a.fecha_inicio DESC`, [id]),
    query('SELECT * FROM masterizaciones WHERE equipo_id = ? ORDER BY fecha_solicitud DESC', [id]),
    query('SELECT * FROM incidencias WHERE equipo_id = ? ORDER BY fecha_apertura DESC', [id]),
    esIT(req.session.user)
      ? query("SELECT * FROM auditoria WHERE entidad = 'equipo' AND entidad_id = ? ORDER BY fecha DESC LIMIT 200", [id])
      : [],
  ]);
  const mapa = await personas.porIds(asignaciones.map((a) => a.empleado_id));
  for (const a of asignaciones) a.empleado = personas.nombreDe(mapa, a.empleado_id);
  res.json({ asignaciones, masterizaciones, incidencias, auditoria });
}));

module.exports = router;
module.exports.normalizarCodigo = normalizarCodigo;
