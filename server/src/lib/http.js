// Utilidades HTTP comunes

/** Envuelve un handler async para que los errores lleguen al middleware de errores. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Error con código HTTP. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Paginación estándar ?page=1&limit=50 (máx. 200). */
function paginacion(req) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

module.exports = { ah, HttpError, paginacion };
