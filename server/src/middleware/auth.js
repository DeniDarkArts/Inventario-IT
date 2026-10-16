// Autenticación por sesión y control de roles y ámbito.

/** Exige sesión iniciada. */
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'No autenticado' });
  next();
}

/** Exige al menos uno de los roles indicados. */
function requireRol(...roles) {
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'No autenticado' });
    if (!user.roles.some((r) => roles.includes(r.rol))) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    next();
  };
}

function esIT(user) {
  return user.roles.some((r) => r.rol === 'admin_it' || r.rol === 'tecnico_it');
}

/** IT o lector: ve todo el inventario (el lector no puede modificar). */
function veTodo(user) {
  return esIT(user) || user.roles.some((r) => r.rol === 'lector');
}

/**
 * Devuelve el ámbito visible del usuario para filtrar consultas:
 *  - { todo: true }                       IT o lector
 *  - { bus: [...], proyectoIds: [...] }   responsable (BU por nombre, de ing039)
 *  - { empleadoId }                       empleado (Id de ing039.users)
 */
function ambito(user) {
  if (veTodo(user)) return { todo: true };
  const resp = user.roles.filter((r) => r.rol === 'responsable');
  if (resp.length) {
    return {
      bus: resp.map((r) => r.bu).filter(Boolean),
      proyectoIds: resp.map((r) => r.proyecto_id).filter(Boolean),
      empleadoId: user.empleado_id,
    };
  }
  return { empleadoId: user.empleado_id };
}

module.exports = { requireAuth, requireRol, esIT, veTodo, ambito };
