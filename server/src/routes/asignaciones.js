// /api/asignaciones — asignar, devolver y cambiar de proyecto
const router = require('express').Router();
const fs = require('fs/promises');
const path = require('path');
const { transaction } = require('../db');
const { ah, HttpError } = require('../lib/http');
const { auditar } = require('../lib/auditoria');
const { requireRol } = require('../middleware/auth');
const personas = require('../lib/personas');

const IT = ['admin_it', 'tecnico_it'];
const UPLOAD_DIR = path.resolve(__dirname, '../..', process.env.UPLOAD_DIR || '../uploads');

/** Guarda una firma en base64 (data:image/png;base64,...) y devuelve su ruta relativa. */
async function guardarFirma(dataUrl, nombre) {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Firma con formato no válido');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 512 * 1024) throw new HttpError(400, 'Firma demasiado grande');
  const dir = path.join(UPLOAD_DIR, 'firmas');
  await fs.mkdir(dir, { recursive: true });
  const fichero = `${nombre}-${Date.now()}.png`;
  await fs.writeFile(path.join(dir, fichero), buf);
  return `firmas/${fichero}`;
  // TODO fase 2: generar el acta en PDF (PDFKit) con datos del equipo + firma
}

const textoOpc = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

/**
 * POST /api/asignaciones
 * body: { equipo_ids: [..] | equipo_id, empleado_id (Id de ing039), proyecto_id, ubicacion_id | oficina, edificio, puesto,
 *         tipo: 'personal'|'puesto'|'prestamo', fecha_fin_prevista, firma, notas }
 * Admite varios equipos (entrega en lote con una sola firma).
 */
router.post('/', requireRol(...IT), ah(async (req, res) => {
  const b = req.body || {};
  const ids = b.equipo_ids || (b.equipo_id ? [b.equipo_id] : []);
  if (!ids.length) throw new HttpError(400, 'Indica al menos un equipo');
  const tipo = b.tipo || 'personal';
  if (tipo !== 'puesto' && !b.empleado_id) throw new HttpError(400, 'empleado_id es obligatorio');
  if (tipo === 'prestamo' && !b.fecha_fin_prevista) throw new HttpError(400, 'Un préstamo necesita fecha_fin_prevista');
  // La persona tiene que existir en ING039 y no estar de baja
  const persona = tipo === 'puesto' ? null : await personas.porId(b.empleado_id);
  if (tipo !== 'puesto' && !persona) throw new HttpError(400, 'La persona no existe en ING039');
  if (persona?.baja) throw new HttpError(409, `${persona.nombre_completo} está de baja en ING039 desde el ${persona.baja}`);
  const empleadoId = persona?.id ?? null;
  // Sitio de la entrega: una ubicación propia (cliente, almacén…) o una oficina (Site de ing039)
  const ubicacionId = b.ubicacion_id || null;
  const oficina = ubicacionId ? null : textoOpc(b.oficina, 80);

  const acta = await guardarFirma(b.firma, `entrega-${empleadoId || 'puesto'}`);
  const avisos = [];

  const creadas = await transaction(async (conn) => {
    const out = [];
    for (const equipoId of ids) {
      const [[eq]] = await conn.execute('SELECT id, codigo_interno, estado FROM equipos WHERE id = ? FOR UPDATE', [equipoId]);
      if (!eq) throw new HttpError(404, `Equipo ${equipoId} no encontrado`);
      if (!['en_stock', 'reservado', 'pendiente_master'].includes(eq.estado)) {
        throw new HttpError(409, `${eq.codigo_interno} no está libre (estado: ${eq.estado})`);
      }
      const [[inc]] = await conn.execute(
        "SELECT COUNT(*) AS n FROM incidencias WHERE equipo_id = ? AND estado IN ('abierta','en_curso','en_reparacion')", [eq.id]);
      if (inc.n) throw new HttpError(409, `${eq.codigo_interno} tiene incidencias abiertas`);

      // Aviso si el equipo no es de la BU del proyecto (o, sin proyecto, de la BU de la persona)
      const [[pr]] = b.proyecto_id ? await conn.execute('SELECT bu FROM proyectos WHERE id = ?', [b.proyecto_id]) : [[null]];
      const buDestino = pr?.bu || persona?.bu;
      if (buDestino) {
        const [[cruce]] = await conn.execute(
          'SELECT NOT EXISTS (SELECT 1 FROM equipo_unidades WHERE equipo_id = ? AND bu = ?) AS otra_bu', [eq.id, buDestino]);
        if (cruce.otra_bu) avisos.push(`${eq.codigo_interno} no es de la BU ${buDestino}`);
      }

      const [r] = await conn.execute(
        `INSERT INTO asignaciones (equipo_id, empleado_id, proyecto_id, ubicacion_id, oficina, tipo, fecha_inicio,
           fecha_fin_prevista, acta_entrega, asignado_por, notas)
         VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, ?)`,
        [eq.id, empleadoId, b.proyecto_id || null, ubicacionId, oficina, tipo,
         b.fecha_fin_prevista || null, acta, req.session.user.id, b.notas || null]);
      // El sitio físico pasa a ser el de la entrega (edificio y puesto opcionales, NULL si no se indican)
      await conn.execute(
        `UPDATE equipos SET estado = 'asignado', estado_previo = ?, edificio = ?, puesto = ?
           ${ubicacionId || oficina ? ', ubicacion_id = ?, oficina = ?' : ''}
         WHERE id = ?`,
        [eq.estado, textoOpc(b.edificio, 60), textoOpc(b.puesto, 40),
         ...(ubicacionId || oficina ? [ubicacionId, oficina] : []), eq.id]);
      await auditar(conn, req, 'asignacion', r.insertId, 'asignar', null, { equipo_id: eq.id, ...b, firma: undefined });
      out.push(r.insertId);
    }
    return out;
  });
  res.status(201).json({ asignaciones: creadas, avisos });
}));

/**
 * POST /api/asignaciones/:id/devolver
 * body: { estado_devolucion: 'correcto'|'con_danos'|'falta_accesorio', firma, notas }
 * El equipo pasa a 'en_revision'. Si viene con daños, se abre incidencia.
 */
router.post('/:id(\\d+)/devolver', requireRol(...IT), ah(async (req, res) => {
  const b = req.body || {};
  const estadoDev = b.estado_devolucion || 'correcto';
  const acta = await guardarFirma(b.firma, `devolucion-${req.params.id}`);
  await transaction(async (conn) => {
    const [[a]] = await conn.execute(
      'SELECT * FROM asignaciones WHERE id = ? AND fecha_devolucion IS NULL FOR UPDATE', [req.params.id]);
    if (!a) throw new HttpError(404, 'Asignación abierta no encontrada');
    await conn.execute(
      'UPDATE asignaciones SET fecha_devolucion = CURDATE(), estado_devolucion = ?, acta_devolucion = ?, notas = CONCAT_WS(\'\\n\', notas, ?) WHERE id = ?',
      [estadoDev, acta, b.notas || null, a.id]);
    // Vuelve al almacén de IT: sin oficina, edificio ni puesto
    await conn.execute(
      `UPDATE equipos SET estado = 'en_revision', estado_previo = 'asignado', oficina = NULL, edificio = NULL, puesto = NULL,
         ubicacion_id = COALESCE((SELECT id FROM ubicaciones WHERE tipo = 'almacen' AND activa = 1 ORDER BY id LIMIT 1), ubicacion_id)
       WHERE id = ?`, [a.equipo_id]);
    if (estadoDev !== 'correcto') {
      await conn.execute(
        `INSERT INTO incidencias (equipo_id, reportada_por, categoria, descripcion)
         VALUES (?, ?, ?, ?)`,
        [a.equipo_id, req.session.user.id, estadoDev === 'con_danos' ? 'dano_fisico' : 'otro',
         `Detectado en la devolución: ${estadoDev}. ${b.notas || ''}`.trim()]);
    }
    await auditar(conn, req, 'asignacion', a.id, 'devolver', a, { estado_devolucion: estadoDev });
  });
  res.json({ ok: true });
}));

/**
 * POST /api/asignaciones/:id/cambiar-proyecto
 * body: { proyecto_id, ubicacion_id | oficina }
 * Cierra la asignación actual y abre otra igual con el nuevo proyecto.
 * Si el cliente del nuevo proyecto exige su dominio, crea masterización pendiente.
 */
router.post('/:id(\\d+)/cambiar-proyecto', requireRol(...IT), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.proyecto_id) throw new HttpError(400, 'proyecto_id es obligatorio');
  const resultado = await transaction(async (conn) => {
    const [[a]] = await conn.execute(
      'SELECT * FROM asignaciones WHERE id = ? AND fecha_devolucion IS NULL FOR UPDATE', [req.params.id]);
    if (!a) throw new HttpError(404, 'Asignación abierta no encontrada');
    await conn.execute(
      "UPDATE asignaciones SET fecha_devolucion = CURDATE(), estado_devolucion = 'correcto', notas = CONCAT_WS('\\n', notas, 'Cierre por cambio de proyecto') WHERE id = ?",
      [a.id]);
    const [r] = await conn.execute(
      `INSERT INTO asignaciones (equipo_id, empleado_id, proyecto_id, ubicacion_id, oficina, tipo, fecha_inicio,
         fecha_fin_prevista, acta_entrega, asignado_por)
       VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?)`,
      [a.equipo_id, a.empleado_id, b.proyecto_id,
       b.ubicacion_id || (b.oficina ? null : a.ubicacion_id), b.ubicacion_id ? null : (textoOpc(b.oficina, 80) || a.oficina), a.tipo,
       a.fecha_fin_prevista, a.acta_entrega, req.session.user.id]);

    const [[cli]] = await conn.execute(
      `SELECT c.id, c.requiere_master_cliente, c.dominio_ad FROM proyectos p
         JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?`, [b.proyecto_id]);
    let masterPendiente = false;
    if (cli?.requiere_master_cliente) {
      await conn.execute(
        `INSERT INTO masterizaciones (equipo_id, tipo, cliente_id, dominio, estado) VALUES (?, 'cliente', ?, ?, 'pendiente')`,
        [a.equipo_id, cli.id, cli.dominio_ad]);
      masterPendiente = true;
    }
    await auditar(conn, req, 'asignacion', r.insertId, 'cambiar_proyecto', { asignacion_id: a.id, proyecto_id: a.proyecto_id }, b);
    return { asignacion_id: r.insertId, master_pendiente: masterPendiente };
  });
  res.status(201).json(resultado);
}));

module.exports = router;
