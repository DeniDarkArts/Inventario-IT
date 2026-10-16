-- =====================================================================
-- Inventario IT — Esquema MySQL 8.0+
-- Crea la base de datos, las tablas y la vista de disponibilidad.
-- Personas, BU y oficinas NO están aquí: se leen en vivo de ing039.users (server/src/lib/personas.js).
-- Las columnas empleado_id / responsable_id guardan el Id de ing039.users (sin clave foránea).
-- Uso: mysql -u root -p < database/schema.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS inventario_it
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE inventario_it;

SET FOREIGN_KEY_CHECKS = 0;
DROP VIEW  IF EXISTS v_equipos_disponibilidad;
DROP TABLE IF EXISTS auditoria, solicitudes, incidencia_adjuntos, incidencias,
  masterizaciones, asignaciones, equipo_unidades, equipos, usuario_roles,
  usuarios, empleados, modelo_codigos, modelos, tipos_equipo, proyectos, ubicaciones,
  clientes, unidades_negocio;  -- empleados y unidades_negocio: tablas antiguas, ya no se crean
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
  id                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre                   VARCHAR(120) NOT NULL UNIQUE,
  dominio_ad               VARCHAR(120) NULL,
  requiere_master_cliente  TINYINT(1)   NOT NULL DEFAULT 0,
  contacto_it              VARCHAR(200) NULL,
  activo                   TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE ubicaciones (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo        ENUM('cliente','almacen','reparacion') NOT NULL,  -- las oficinas son el Site de ing039
  cliente_id  INT UNSIGNED NULL,
  nombre      VARCHAR(120) NOT NULL,
  direccion   VARCHAR(255) NULL,
  activa      TINYINT(1)   NOT NULL DEFAULT 1,
  CONSTRAINT fk_ubic_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) ENGINE=InnoDB;

CREATE TABLE proyectos (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo          VARCHAR(40)  NOT NULL UNIQUE,
  nombre          VARCHAR(160) NOT NULL,
  cliente_id      INT UNSIGNED NULL,
  bu              VARCHAR(80)  NOT NULL,          -- BU de ing039.users
  responsable_id  INT UNSIGNED NULL,              -- Id de ing039.users
  fecha_inicio    DATE NULL,
  fecha_fin       DATE NULL,
  activo          TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_proy_bu (bu),
  CONSTRAINT fk_proy_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) ENGINE=InnoDB;

CREATE TABLE tipos_equipo (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(60) NOT NULL UNIQUE,
  prefijo       VARCHAR(5)  NOT NULL,             -- para codigo_interno (TEC, POR...)
  lleva_qr      TINYINT(1)  NOT NULL DEFAULT 1,
  es_accesorio  TINYINT(1)  NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE modelos (
  id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo_id  INT UNSIGNED NOT NULL,
  marca    VARCHAR(60)  NOT NULL,
  modelo   VARCHAR(120) NOT NULL,
  specs    JSON NULL,                             -- {"cpu":..,"ram_gb":..,"disco_gb":..,"pulgadas":..}
  UNIQUE KEY uk_modelo (tipo_id, marca, modelo),
  CONSTRAINT fk_modelo_tipo FOREIGN KEY (tipo_id) REFERENCES tipos_equipo(id)
) ENGINE=InnoDB;

-- Códigos de producto del fabricante (ProdID HP, P/N...) → modelo; se aprenden al dar de alta
CREATE TABLE modelo_codigos (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo     VARCHAR(40)  NOT NULL UNIQUE,
  modelo_id  INT UNSIGNED NOT NULL,
  CONSTRAINT fk_modcod_modelo FOREIGN KEY (modelo_id) REFERENCES modelos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Cuentas de acceso (las personas están en ing039.users)
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empleado_id        INT UNSIGNED NULL,             -- Id de ing039.users (NULL en cuentas locales)
  email              VARCHAR(160) NOT NULL UNIQUE,
  password_hash      VARCHAR(100) NULL,             -- NULL si auth_origen <> 'local'
  auth_origen        ENUM('local','entra','ing039') NOT NULL DEFAULT 'local',  -- ing039: BD de usuarios corporativa
  entra_oid          VARCHAR(64) NULL UNIQUE,
  activo             TINYINT(1) NOT NULL DEFAULT 1,
  intentos_fallidos  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta    DATETIME NULL,
  ultimo_acceso      DATETIME NULL,
  KEY idx_usr_emp (empleado_id)
) ENGINE=InnoDB;

-- Solo para cuentas locales: los roles de ing039 se calculan en cada login
CREATE TABLE usuario_roles (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id   INT UNSIGNED NOT NULL,
  rol          ENUM('admin_it','tecnico_it','lector','responsable','empleado') NOT NULL,  -- lector: ve todo, no modifica
  bu           VARCHAR(80)  NULL,                   -- ámbito del responsable (BU de ing039)
  proyecto_id  INT UNSIGNED NULL,
  CONSTRAINT fk_rol_usr  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_rol_proy FOREIGN KEY (proyecto_id) REFERENCES proyectos(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Equipos y uso
-- ---------------------------------------------------------------------
CREATE TABLE equipos (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo_qr        VARCHAR(40)  NULL UNIQUE,        -- NULL para teclados
  codigo_interno   VARCHAR(20)  NOT NULL UNIQUE,    -- CT-000123 / TEC-000045
  tipo_id          INT UNSIGNED NOT NULL,
  modelo_id        INT UNSIGNED NULL,
  num_serie        VARCHAR(80)  NULL,
  hostname         VARCHAR(80)  NULL,
  estado           ENUM('en_stock','reservado','pendiente_master','asignado',
                        'en_revision','en_reparacion','perdido','baja_definitiva')
                   NOT NULL DEFAULT 'en_stock',
  estado_previo    VARCHAR(30)  NULL,               -- para volver tras reparación
  propiedad        ENUM('empresa','cliente') NOT NULL DEFAULT 'empresa',
  ubicacion_id     INT UNSIGNED NULL,               -- cliente, almacén o reparación…
  oficina          VARCHAR(80)  NULL,               -- …o una oficina propia (Site de ing039)
  edificio         VARCHAR(60)  NULL,               -- dentro de la ubicación (opcional)
  puesto           VARCHAR(40)  NULL,
  equipo_padre_id  INT UNSIGNED NULL,               -- teclado/dock vinculado a un portátil
  fecha_compra     DATE NULL,
  proveedor        VARCHAR(120) NULL,
  orden_compra     VARCHAR(40)  NULL,
  garantia_hasta   DATE NULL,
  coste            DECIMAL(10,2) NULL,
  observaciones    TEXT NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_eq_estado (estado),
  KEY idx_eq_serie (num_serie),
  KEY idx_eq_orden_compra (orden_compra),
  CONSTRAINT fk_eq_tipo   FOREIGN KEY (tipo_id)         REFERENCES tipos_equipo(id),
  CONSTRAINT fk_eq_modelo FOREIGN KEY (modelo_id)       REFERENCES modelos(id),
  CONSTRAINT fk_eq_ubic   FOREIGN KEY (ubicacion_id)    REFERENCES ubicaciones(id),
  CONSTRAINT fk_eq_padre  FOREIGN KEY (equipo_padre_id) REFERENCES equipos(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- BU que pueden usar cada equipo (nombre de la BU en ing039.users)
CREATE TABLE equipo_unidades (
  equipo_id   INT UNSIGNED NOT NULL,
  bu          VARCHAR(80)  NOT NULL,
  principal   TINYINT(1) NOT NULL DEFAULT 0,
  porcentaje  DECIMAL(5,2) NULL,
  PRIMARY KEY (equipo_id, bu),
  KEY idx_equn_bu (bu),
  CONSTRAINT fk_equn_eq FOREIGN KEY (equipo_id) REFERENCES equipos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE asignaciones (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  equipo_id          INT UNSIGNED NOT NULL,
  empleado_id        INT UNSIGNED NULL,             -- Id de ing039.users; NULL si tipo = 'puesto'
  proyecto_id        INT UNSIGNED NULL,
  ubicacion_id       INT UNSIGNED NULL,
  oficina            VARCHAR(80)  NULL,             -- Site de ing039 si se entrega en una oficina
  tipo               ENUM('personal','puesto','prestamo') NOT NULL DEFAULT 'personal',
  fecha_inicio       DATE NOT NULL,
  fecha_fin_prevista DATE NULL,
  fecha_devolucion   DATE NULL,
  estado_devolucion  ENUM('correcto','con_danos','falta_accesorio') NULL,
  acta_entrega       VARCHAR(255) NULL,             -- ruta del PDF firmado
  acta_devolucion    VARCHAR(255) NULL,
  asignado_por       INT UNSIGNED NOT NULL,
  notas              TEXT NULL,
  -- Garantiza UNA sola asignación abierta por equipo
  abierta            INT UNSIGNED AS (IF(fecha_devolucion IS NULL, equipo_id, NULL)) STORED,
  UNIQUE KEY uk_asig_abierta (abierta),
  KEY idx_asig_emp (empleado_id, fecha_devolucion),
  KEY idx_asig_proy (proyecto_id),
  CONSTRAINT fk_asig_eq   FOREIGN KEY (equipo_id)    REFERENCES equipos(id),
  CONSTRAINT fk_asig_proy FOREIGN KEY (proyecto_id)  REFERENCES proyectos(id),
  CONSTRAINT fk_asig_ubic FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  CONSTRAINT fk_asig_usr  FOREIGN KEY (asignado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE masterizaciones (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  equipo_id         INT UNSIGNED NOT NULL,
  tipo              ENUM('interna','cliente') NOT NULL,
  cliente_id        INT UNSIGNED NULL,
  dominio           VARCHAR(120) NULL,
  imagen_version    VARCHAR(60)  NULL,
  estado            ENUM('pendiente','en_curso','enviado_cliente','completada','fallida')
                    NOT NULL DEFAULT 'pendiente',
  fecha_solicitud   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_envio       DATETIME NULL,
  fecha_completada  DATETIME NULL,
  tecnico_id        INT UNSIGNED NULL,
  notas             TEXT NULL,
  KEY idx_mast_estado (estado),
  CONSTRAINT fk_mast_eq  FOREIGN KEY (equipo_id)  REFERENCES equipos(id),
  CONSTRAINT fk_mast_cli FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  CONSTRAINT fk_mast_tec FOREIGN KEY (tecnico_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE incidencias (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  equipo_id            INT UNSIGNED NOT NULL,
  reportada_por        INT UNSIGNED NOT NULL,
  categoria            ENUM('teclado','pantalla','bateria','software','dano_fisico','perdida_robo','otro') NOT NULL,
  prioridad            ENUM('baja','media','alta','critica') NOT NULL DEFAULT 'media',
  estado               ENUM('abierta','en_curso','en_reparacion','resuelta','cerrada') NOT NULL DEFAULT 'abierta',
  descripcion          TEXT NOT NULL,
  resolucion           TEXT NULL,
  equipo_sustituto_id  INT UNSIGNED NULL,
  fecha_apertura       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre         DATETIME NULL,
  tecnico_id           INT UNSIGNED NULL,
  KEY idx_inc_estado (estado),
  CONSTRAINT fk_inc_eq   FOREIGN KEY (equipo_id)           REFERENCES equipos(id),
  CONSTRAINT fk_inc_rep  FOREIGN KEY (reportada_por)       REFERENCES usuarios(id),
  CONSTRAINT fk_inc_sust FOREIGN KEY (equipo_sustituto_id) REFERENCES equipos(id),
  CONSTRAINT fk_inc_tec  FOREIGN KEY (tecnico_id)          REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE incidencia_adjuntos (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incidencia_id  INT UNSIGNED NOT NULL,
  ruta           VARCHAR(255) NOT NULL,
  tipo           VARCHAR(80)  NOT NULL,
  subido_por     INT UNSIGNED NOT NULL,
  fecha          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_adj_inc FOREIGN KEY (incidencia_id) REFERENCES incidencias(id) ON DELETE CASCADE,
  CONSTRAINT fk_adj_usr FOREIGN KEY (subido_por)    REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE solicitudes (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  solicitante_id   INT UNSIGNED NOT NULL,
  empleado_id      INT UNSIGNED NOT NULL,         -- Id de ing039.users
  proyecto_id      INT UNSIGNED NULL,
  tipo_equipo_id   INT UNSIGNED NOT NULL,
  motivo           TEXT NULL,
  fecha_necesaria  DATE NULL,
  estado           ENUM('pendiente','aprobada','rechazada','servida') NOT NULL DEFAULT 'pendiente',
  asignacion_id    INT UNSIGNED NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sol_usr  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id),
  CONSTRAINT fk_sol_proy FOREIGN KEY (proyecto_id)    REFERENCES proyectos(id),
  CONSTRAINT fk_sol_tipo FOREIGN KEY (tipo_equipo_id) REFERENCES tipos_equipo(id),
  CONSTRAINT fk_sol_asig FOREIGN KEY (asignacion_id)  REFERENCES asignaciones(id)
) ENGINE=InnoDB;

CREATE TABLE auditoria (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT UNSIGNED NULL,
  entidad     VARCHAR(40) NOT NULL,
  entidad_id  INT UNSIGNED NOT NULL,
  accion      VARCHAR(40) NOT NULL,
  antes       JSON NULL,
  despues     JSON NULL,
  fecha       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip          VARCHAR(45) NULL,
  KEY idx_aud_entidad (entidad, entidad_id),
  CONSTRAINT fk_aud_usr FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Vista de disponibilidad
-- ---------------------------------------------------------------------
-- "Libre próximamente" por baja del empleado lo añade el servidor con ing039.users.Baja (routes/disponibilidad.js)
CREATE VIEW v_equipos_disponibilidad AS
SELECT
  e.id, e.codigo_qr, e.codigo_interno, e.estado, e.num_serie, e.hostname,
  t.nombre AS tipo, m.marca, m.modelo, m.specs,
  e.ubicacion_id, COALESCE(u.nombre, e.oficina) AS ubicacion, e.oficina, e.edificio, e.puesto,
  (SELECT GROUP_CONCAT(eu.bu ORDER BY eu.principal DESC SEPARATOR ', ')
     FROM equipo_unidades eu WHERE eu.equipo_id = e.id) AS unidades,
  a.id AS asignacion_id, a.empleado_id, a.fecha_fin_prevista,
  EXISTS (SELECT 1 FROM incidencias i
           WHERE i.equipo_id = e.id AND i.estado IN ('abierta','en_curso','en_reparacion')) AS con_incidencia,
  CASE
    WHEN EXISTS (SELECT 1 FROM incidencias i
                  WHERE i.equipo_id = e.id AND i.estado IN ('abierta','en_curso','en_reparacion'))
      THEN 'no_disponible'
    WHEN e.estado = 'en_stock' AND a.id IS NULL
      THEN 'libre'
    WHEN e.estado IN ('en_revision','pendiente_master') AND a.id IS NULL
      THEN 'libre_tras_preparacion'
    WHEN a.id IS NOT NULL AND a.fecha_fin_prevista IS NOT NULL
      THEN 'libre_proximamente'
    ELSE 'no_disponible'
  END AS disponibilidad,
  a.fecha_fin_prevista AS libre_desde
FROM equipos e
JOIN tipos_equipo t      ON t.id = e.tipo_id
LEFT JOIN modelos m      ON m.id = e.modelo_id
LEFT JOIN ubicaciones u  ON u.id = e.ubicacion_id
LEFT JOIN asignaciones a ON a.equipo_id = e.id AND a.fecha_devolucion IS NULL
WHERE e.estado NOT IN ('perdido','baja_definitiva');
