// Registro de auditoría: quién, cuándo, desde dónde, antes y después.

/**
 * @param {object} conn  conexión (dentro de una transacción) o el pool
 * @param {object} req   petición Express (para usuario e IP)
 * @param {string} entidad  'equipo', 'asignacion', 'empleado'...
 * @param {number} entidadId
 * @param {string} accion   'crear', 'editar', 'asignar', 'devolver'...
 * @param {object|null} antes
 * @param {object|null} despues
 */
async function auditar(conn, req, entidad, entidadId, accion, antes = null, despues = null) {
  await conn.execute(
    `INSERT INTO auditoria (usuario_id, entidad, entidad_id, accion, antes, despues, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      req.session?.user?.id ?? null,
      entidad,
      entidadId,
      accion,
      antes ? JSON.stringify(antes) : null,
      despues ? JSON.stringify(despues) : null,
      req.ip,
    ]
  );
}

module.exports = { auditar };
