-- =====================================================================
-- Inventario IT — Esquema MySQL 8.0+
-- Crea la base de datos, 16 tablas y la vista de disponibilidad.
-- Uso: mysql -u root -p < database/schema.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS inventario_it
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE inventario_it;

SET FOREIGN_KEY_CHECKS = 0;
DROP VIEW  IF EXISTS v_equipos_disponibilidad;
DROP TABLE IF EXISTS auditoria, solicitudes, incidencia_adjuntos, incidencias,
  masterizaciones, asignaciones, equipo_unidades, equipos, usuario_roles,
  usuarios, empleados, modelos, tipos_equipo, proyectos, ubicaciones,
  clientes, unidades_negocio;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------
CREATE TABLE unidades_negocio (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo          VARCHAR(20)  NOT NULL UNIQUE,
  nombre          VARCHAR(120) NOT NULL,
  responsable_id  INT UNSIGNED NULL,              -- FK a empleados (al final)
  activa          TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

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
  tipo        ENUM('oficina','cliente','almacen','reparacion') NOT NULL,
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
  un_id           INT UNSIGNED NOT NULL,
  responsable_id  INT UNSIGNED NULL,              -- FK a empleados (al final)
  fecha_inicio    DATE NULL,
  fecha_fin       DATE NULL,
  activo          TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_proy_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  CONSTRAINT fk_proy_un      FOREIGN KEY (un_id)      REFERENCES unidades_negocio(id)
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

-- ---------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------
CREATE TABLE empleados (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  num_empleado         VARCHAR(20)  NOT NULL UNIQUE,
  nombre               VARCHAR(80)  NOT NULL,
  apellidos            VARCHAR(120) NOT NULL,
  email                VARCHAR(160) NOT NULL UNIQUE,
  un_id                INT UNSIGNED NOT NULL,
  proyecto_actual_id   INT UNSIGNED NULL,
  ubicacion_id         INT UNSIGNED NULL,
  estado               ENUM('pendiente_alta','activo','pendiente_baja','baja') NOT NULL DEFAULT 'pendiente_alta',
  fecha_alta           DATE NOT NULL,
  fecha_baja_prevista  DATE NULL,
  fecha_baja           DATE NULL,
  creado_en            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_emp_estado (estado),
  CONSTRAINT fk_emp_un    FOREIGN KEY (un_id)              REFERENCES unidades_negocio(id),
  CONSTRAINT fk_emp_proy  FOREIGN KEY (proyecto_actual_id) REFERENCES proyectos(id),
  CONSTRAINT fk_emp_ubic  FOREIGN KEY (ubicacion_id)       REFERENCES ubicaciones(id)
) ENGINE=InnoDB;

CREATE TABLE usuarios (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empleado_id        INT UNSIGNED NULL,
  email              VARCHAR(160) NOT NULL UNIQUE,
  password_hash      VARCHAR(100) NULL,             -- NULL si auth_origen = 'entra'
  auth_origen        ENUM('local','entra') NOT NULL DEFAULT 'local',
  entra_oid          VARCHAR(64) NULL UNIQUE,
  activo             TINYINT(1) NOT NULL DEFAULT 1,
  intentos_fallidos  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta    DATETIME NULL,
  ultimo_acceso      DATETIME NULL,
  CONSTRAINT fk_usr_emp FOREIGN KEY (empleado_id) REFERENCES empleados(id)
) ENGINE=InnoDB;

CREATE TABLE usuario_roles (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id   INT UNSIGNED NOT NULL,
  rol          ENUM('admin_it','tecnico_it','responsable','empleado') NOT NULL,
  un_id        INT UNSIGNED NULL,                   -- ámbito del responsable
  proyecto_id  INT UNSIGNED NULL,
  CONSTRAINT fk_rol_usr  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_rol_un   FOREIGN KEY (un_id)       REFERENCES unidades_negocio(id),
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
  ubicacion_id     INT UNSIGNED NULL,
  equipo_padre_id  INT UNSIGNED NULL,               -- teclado/dock vinculado a un portátil
  fecha_compra     DATE NULL,
  proveedor        VARCHAR(120) NULL,
  garantia_hasta   DATE NULL,
  coste            DECIMAL(10,2) NULL,
  observaciones    TEXT NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_eq_estado (estado),
  KEY idx_eq_serie (num_serie),
  CONSTRAINT fk_eq_tipo   FOREIGN KEY (tipo_id)         REFERENCES tipos_equipo(id),
  CONSTRAINT fk_eq_modelo FOREIGN KEY (modelo_id)       REFERENCES modelos(id),
  CONSTRAINT fk_eq_ubic   FOREIGN KEY (ubicacion_id)    REFERENCES ubicaciones(id),
  CONSTRAINT fk_eq_padre  FOREIGN KEY (equipo_padre_id) REFERENCES equipos(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE equipo_unidades (
  equipo_id   INT UNSIGNED NOT NULL,
  un_id       INT UNSIGNED NOT NULL,
  principal   TINYINT(1) NOT NULL DEFAULT 0,
  porcentaje  DECIMAL(5,2) NULL,
  PRIMARY KEY (equipo_id, un_id),
  CONSTRAINT fk_equn_eq FOREIGN KEY (equipo_id) REFERENCES equipos(id) ON DELETE CASCADE,
  CONSTRAINT fk_equn_un FOREIGN KEY (un_id)     REFERENCES unidades_negocio(id)
) ENGINE=InnoDB;

CREATE TABLE asignaciones (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  equipo_id          INT UNSIGNED NOT NULL,
  empleado_id        INT UNSIGNED NULL,             -- NULL si tipo = 'puesto'
  proyecto_id        INT UNSIGNED NULL,
  ubicacion_id       INT UNSIGNED NULL,
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
  CONSTRAINT fk_asig_emp  FOREIGN KEY (empleado_id)  REFERENCES empleados(id),
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
  empleado_id      INT UNSIGNED NOT NULL,
  proyecto_id      INT UNSIGNED NULL,
  tipo_equipo_id   INT UNSIGNED NOT NULL,
  motivo           TEXT NULL,
  fecha_necesaria  DATE NULL,
  estado           ENUM('pendiente','aprobada','rechazada','servida') NOT NULL DEFAULT 'pendiente',
  asignacion_id    INT UNSIGNED NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sol_usr  FOREIGN KEY (solicitante_id) REFERENCES usuarios(id),
  CONSTRAINT fk_sol_emp  FOREIGN KEY (empleado_id)    REFERENCES empleados(id),
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

-- Claves circulares (empleados ↔ unidades/proyectos)
ALTER TABLE unidades_negocio
  ADD CONSTRAINT fk_un_resp FOREIGN KEY (responsable_id) REFERENCES empleados(id);
ALTER TABLE proyectos
  ADD CONSTRAINT fk_proy_resp FOREIGN KEY (responsable_id) REFERENCES empleados(id);

-- ---------------------------------------------------------------------
-- Vista de disponibilidad
-- ---------------------------------------------------------------------
CREATE VIEW v_equipos_disponibilidad AS
SELECT
  e.id, e.codigo_qr, e.codigo_interno, e.estado, e.num_serie, e.hostname,
  t.nombre AS tipo, m.marca, m.modelo, m.specs,
  e.ubicacion_id, u.nombre AS ubicacion,
  (SELECT GROUP_CONCAT(un.codigo ORDER BY eu.principal DESC SEPARATOR ',')
     FROM equipo_unidades eu JOIN unidades_negocio un ON un.id = eu.un_id
    WHERE eu.equipo_id = e.id) AS unidades,
  a.id AS asignacion_id, a.empleado_id, a.fecha_fin_prevista,
  emp.estado AS estado_empleado, emp.fecha_baja_prevista,
  CASE
    WHEN EXISTS (SELECT 1 FROM incidencias i
                  WHERE i.equipo_id = e.id AND i.estado IN ('abierta','en_curso','en_reparacion'))
      THEN 'no_disponible'
    WHEN e.estado = 'en_stock' AND a.id IS NULL
      THEN 'libre'
    WHEN e.estado IN ('en_revision','pendiente_master') AND a.id IS NULL
      THEN 'libre_tras_preparacion'
    WHEN a.id IS NOT NULL AND (a.fecha_fin_prevista IS NOT NULL OR emp.estado = 'pendiente_baja')
      THEN 'libre_proximamente'
    ELSE 'no_disponible'
  END AS disponibilidad,
  COALESCE(a.fecha_fin_prevista, emp.fecha_baja_prevista) AS libre_desde
FROM equipos e
JOIN tipos_equipo t      ON t.id = e.tipo_id
LEFT JOIN modelos m      ON m.id = e.modelo_id
LEFT JOIN ubicaciones u  ON u.id = e.ubicacion_id
LEFT JOIN asignaciones a ON a.equipo_id = e.id AND a.fecha_devolucion IS NULL
LEFT JOIN empleados emp  ON emp.id = a.empleado_id
WHERE e.estado NOT IN ('perdido','baja_definitiva');
