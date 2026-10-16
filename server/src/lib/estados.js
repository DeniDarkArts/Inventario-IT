// Máquina de estados del equipo (ver docs/especificacion.md, "Ciclo de vida")

const TRANSICIONES = {
  en_stock:         ['reservado', 'pendiente_master', 'asignado', 'en_reparacion', 'perdido', 'baja_definitiva'],
  reservado:        ['en_stock', 'pendiente_master', 'asignado'],
  pendiente_master: ['en_stock', 'reservado', 'asignado'],
  asignado:         ['en_revision', 'en_reparacion', 'perdido', 'pendiente_master'],
  en_revision:      ['en_stock', 'en_reparacion', 'pendiente_master', 'baja_definitiva'],
  en_reparacion:    ['en_stock', 'asignado', 'en_revision', 'baja_definitiva'],
  perdido:          ['en_stock'], // recuperado
  baja_definitiva:  [],
};

const ESTADOS = Object.keys(TRANSICIONES);

function puedeTransicionar(desde, hasta) {
  return (TRANSICIONES[desde] || []).includes(hasta);
}

class TransicionInvalida extends Error {
  constructor(desde, hasta) {
    super(`No se puede pasar de "${desde}" a "${hasta}"`);
    this.status = 409;
  }
}

function validarTransicion(desde, hasta) {
  if (!puedeTransicionar(desde, hasta)) throw new TransicionInvalida(desde, hasta);
}

module.exports = { ESTADOS, TRANSICIONES, puedeTransicionar, validarTransicion };
