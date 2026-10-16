// /api/catalogos/:tabla — lectura para todos, escritura solo admin IT
const router = require('express').Router();
const { query } = require('../db');
const { ah, HttpError } = require('../lib/http');
const { requireRol } = require('../middleware/auth');
const personas = require('../lib/personas');

// Lista blanca: nombre en la URL → tabla y columnas editables
const CATALOGOS = {
  clientes:    { tabla: 'clientes', cols: ['nombre', 'dominio_ad', 'requiere_master_cliente', 'contacto_it', 'activo'] },
  ubicaciones: { tabla: 'ubicaciones', cols: ['tipo', 'cliente_id', 'nombre', 'direccion', 'activa'] },
  proyectos:   { tabla: 'proyectos', cols: ['codigo', 'nombre', 'cliente_id', 'bu', 'responsable_id', 'fecha_inicio', 'fecha_fin', 'activo'] },
  tipos:       { tabla: 'tipos_equipo', cols: ['nombre', 'prefijo', 'lleva_qr', 'es_accesorio'] },
  modelos:     { tabla: 'modelos', cols: ['tipo_id', 'marca', 'modelo', 'specs'] },
  codigos:     { tabla: 'modelo_codigos', cols: ['codigo', 'modelo_id'] },
};

// Catálogos que vienen de ing039.users (solo lectura): BU y oficinas (Site)
const DE_ING039 = {
  unidades: async () => (await personas.bus()).map((bu) => ({ codigo: bu, nombre: bu })),
  oficinas: async () => (await personas.oficinas()).map((nombre) => ({ nombre })),
};

function catalogo(req) {
  const c = CATALOGOS[req.params.tabla];
  if (!c) throw new HttpError(404, 'Catálogo no encontrado');
  return c;
}

router.get('/:tabla', ah(async (req, res) => {
  if (DE_ING039[req.params.tabla]) return res.json({ items: await DE_ING039[req.params.tabla]() });
  const { tabla } = catalogo(req);
  res.json({ items: await query(`SELECT * FROM ${tabla} ORDER BY id`) });
}));

router.post('/:tabla', requireRol('admin_it'), ah(async (req, res) => {
  const { tabla, cols } = catalogo(req);
  const campos = cols.filter((c) => c in (req.body || {}));
  if (!campos.length) throw new HttpError(400, 'Sin datos');
  const valores = campos.map((c) => (c === 'specs' && typeof req.body[c] === 'object' ? JSON.stringify(req.body[c]) : req.body[c]));
  const r = await query(`INSERT INTO ${tabla} (${campos.join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`, valores);
  res.status(201).json({ id: r.insertId });
}));

router.patch('/:tabla/:id(\\d+)', requireRol('admin_it'), ah(async (req, res) => {
  const { tabla, cols } = catalogo(req);
  const campos = cols.filter((c) => c in (req.body || {}));
  if (!campos.length) throw new HttpError(400, 'Sin datos');
  const valores = campos.map((c) => (c === 'specs' && typeof req.body[c] === 'object' ? JSON.stringify(req.body[c]) : req.body[c]));
  await query(`UPDATE ${tabla} SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...valores, req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
