-- Datos de ejemplo para desarrollo. NO usar en producción.
-- Los usuarios se crean con: npm run crear-admin -- <email> <contraseña>
-- Personas, BU y oficinas vienen de ing039.users: las dos asignaciones de ejemplo usan
-- las dos primeras personas activas de ing039 (debe estar en el mismo servidor MySQL).
USE inventario_it;

INSERT INTO clientes (nombre, dominio_ad, requiere_master_cliente, contacto_it) VALUES
  ('Cliente Aero A', 'aeroa.corp', 1, 'it@aeroa.example'),
  ('Cliente Auto B', NULL, 0, 'soporte@autob.example');

-- 1 almacén, 2 reparación, 3 y 4 clientes (las oficinas son el Site de ing039)
INSERT INTO ubicaciones (tipo, cliente_id, nombre, direccion) VALUES
  ('almacen', NULL, 'Almacén IT', 'Madrid'),
  ('reparacion', NULL, 'Servicio técnico', NULL),
  ('cliente', 1, 'Cliente Aero A — Getafe', 'Getafe'),
  ('cliente', 2, 'Cliente Auto B — Valladolid', 'Valladolid');

INSERT INTO proyectos (codigo, nombre, cliente_id, bu, fecha_inicio) VALUES
  ('P-ME-001', 'Ingeniería de fabricación', 1, 'MANUFACTURING ENGINEERING', '2026-01-15'),
  ('P-SD-001', 'Utillaje línea montaje', 2, 'STRESS & DESIGN', '2026-03-01'),
  ('P-INT-001',  'Proyecto interno oficina', NULL, 'SYSTEMS', '2026-01-01');

INSERT INTO tipos_equipo (nombre, prefijo, lleva_qr, es_accesorio) VALUES
  ('Portátil', 'POR', 1, 0), ('PC sobremesa', 'PC', 1, 0), ('Monitor', 'MON', 1, 0),
  ('Dock', 'DOC', 1, 1), ('Teclado', 'TEC', 0, 1), ('Ratón', 'RAT', 0, 1), ('Móvil', 'MOV', 1, 0);

INSERT INTO modelos (tipo_id, marca, modelo, specs) VALUES
  (1, 'Dell', 'Precision 5680', '{"cpu":"i7-13800H","ram_gb":32,"disco_gb":1000}'),
  (1, 'Lenovo', 'ThinkPad T14 G4', '{"cpu":"i5-1345U","ram_gb":16,"disco_gb":512}'),
  (2, 'HP', 'Z2 G9', '{"cpu":"i9-13900","ram_gb":64,"disco_gb":2000}'),
  (3, 'Dell', 'P2723DE', '{"pulgadas":27}'),
  (4, 'Dell', 'WD22TB4', NULL),
  (5, 'Logitech', 'K120', NULL);

INSERT INTO equipos (codigo_qr, codigo_interno, tipo_id, modelo_id, num_serie, estado, ubicacion_id, oficina, fecha_compra, garantia_hasta) VALUES
  ('CT-000001', 'CT-000001', 1, 1, 'SN-DL-0001', 'asignado', 3, NULL, '2025-04-01', '2028-04-01'),
  ('CT-000002', 'CT-000002', 1, 2, 'SN-LN-0002', 'asignado', NULL, 'Madrid Office', '2024-10-15', '2027-10-15'),
  ('CT-000003', 'CT-000003', 1, 1, 'SN-DL-0003', 'en_stock', 1, NULL, '2026-09-20', '2029-09-20'),
  ('CT-000004', 'CT-000004', 3, 4, 'SN-MN-0004', 'en_stock', 1, NULL, '2026-09-20', '2029-09-20'),
  ('CT-000005', 'CT-000005', 2, 3, 'SN-HP-0005', 'en_revision', 1, NULL, '2023-06-01', '2026-06-01'),
  ('CT-000006', 'CT-000006', 4, 5, 'SN-DK-0006', 'en_stock', 1, NULL, '2026-09-20', '2029-09-20'),
  (NULL,        'TEC-000007', 5, 6, NULL,        'en_stock', 1, NULL, '2026-09-20', NULL);

INSERT INTO equipo_unidades (equipo_id, bu, principal) VALUES
  (1, 'MANUFACTURING ENGINEERING', 1), (2, 'STRESS & DESIGN', 1), (3, 'MANUFACTURING ENGINEERING', 1), (3, 'SYSTEMS', 0),
  (4, 'MANUFACTURING ENGINEERING', 1), (5, 'STRESS & DESIGN', 1), (5, 'MANUFACTURING ENGINEERING', 0),
  (6, 'MANUFACTURING ENGINEERING', 1), (7, 'SYSTEMS', 1);

-- Usuario técnico de ejemplo sin contraseña (crear con npm run crear-admin)
INSERT INTO usuarios (email, auth_origen, activo) VALUES ('sistema@empresa.example', 'local', 0);

-- Dos personas activas de ing039 para las asignaciones de ejemplo
SET @p1 = (SELECT MIN(Id) FROM ing039.users WHERE Baja IS NULL AND TRIM(BU) <> '');
SET @p2 = (SELECT MIN(Id) FROM ing039.users WHERE Baja IS NULL AND TRIM(BU) <> '' AND Id > @p1);

INSERT INTO asignaciones (equipo_id, empleado_id, proyecto_id, ubicacion_id, oficina, tipo, fecha_inicio, asignado_por) VALUES
  (1, @p1, 1, 3, NULL, 'personal', '2025-05-12', 1),
  (2, @p2, 2, NULL, 'Madrid Office', 'personal', '2024-11-04', 1);

INSERT INTO masterizaciones (equipo_id, tipo, cliente_id, dominio, estado, fecha_completada) VALUES
  (1, 'cliente', 1, 'aeroa.corp', 'completada', '2025-05-11 10:00:00'),
  (2, 'interna', NULL, 'ct.local', 'completada', '2024-11-03 09:00:00');
