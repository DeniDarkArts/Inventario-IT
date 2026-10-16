# CLAUDE.md — contexto para seguir trabajando en este repo

## Qué es

Inventario IT para una empresa de ingeniería (CT Ingenieros). Spec: `docs/especificacion.md` (versión viva en Claude Docs: https://claude.ai/code/artifact/1b9daf29-c98c-4326-b3d8-c61db22dfbf9).

## Convenciones

- Idioma: código, comentarios, UI y BD en **español**.
- Backend: Express 4 + `mysql2/promise`. Siempre sentencias preparadas (`query(sql, params)` en `server/src/db.js`). `LIMIT/OFFSET` se interpolan solo tras validarlos como enteros (`paginacion()`).
- Toda operación que cambia equipos o asignaciones va en `transaction()` y llama a `auditar()`.
- Cambios de estado de equipo: validar con `server/src/lib/estados.js`.
- Control de ámbito siempre en servidor (`ambito()` en `middleware/auth.js`): IT y lector ven todo; responsable su BU (`bus`) o proyecto; empleado sus equipos.
- Sesión: `req.session.user = { id, empleado_id, email, roles: [{ rol, bu, proyecto_id }] }`. `empleado_id` es el `Id` de `ing039.users`.
- **Personas, BU, oficinas y bajas NO se copian**: se leen en vivo de `ing039.users` con `server/src/lib/personas.js` (caché de 60 s). En `inventario_it` solo hay equipos, asignaciones, incidencias, masterizaciones, clientes y catálogos propios; las columnas `empleado_id`/`responsable_id` guardan el Id de ing039 (sin FK) y las BU se guardan por nombre (`equipo_unidades.bu`, `proyectos.bu`). Ubicación de un equipo: `ubicacion_id` (cliente, almacén, reparación) **o** `oficina` (Site de ing039), más `edificio` y `puesto`.
- Frontend: HTML + JS vanilla, **sin scripts en línea** (CSP de helmet). Cada página carga `/js/api.js` y su `/js/pages/<pagina>.js`. Escapar siempre con `esc()`.
- Al añadir páginas o JS, añadirlos a `SHELL` en `public/sw.js` y subir `VERSION`.

## Entorno

- Desarrollo en el ordenador de Deni (Windows + XAMPP). Más adelante se moverá a una máquina virtual.
- Montado y probado en local con MariaDB 10.4 de XAMPP (BD `inventario_it`). Arranque: `.claude/launch.json` o `npm --prefix server run dev`.
- ING039: BD corporativa `ing039` (en local, volcado en `BBDD/`, fuera de git; el vigente es `ING039_backup_2026-10-13_09-00.sql`, que trae `users.Baja`; importar con `mysql -uroot ing039 < BBDD/<fichero>`). Nunca se escribe en ella. Las BU son nombres (p. ej. `SYSTEMS`, hasta 62 caracteres). El seed asigna los equipos de demo a las dos primeras personas activas de ing039, así que `ing039` debe existir en el mismo servidor antes de `npm run db:seed`.

## Pendiente inmediato

1. ~~Base de datos de usuarios~~ Hecho: login contra `ing039.users` (argon2id, por email o `WindowsUser`; `AUTH_DB_NAME` en `.env`). Se guarda solo la cuenta en `usuarios` (email + Id de ing039) y los roles se calculan en cada login: Admin→`admin_it`, Project Manager→`responsable` de su BU, Reader→`lector` (ve todo, no modifica), FTE/sin rol→`empleado` (`server/src/lib/usuarios-ing039.js`). `usuario_roles` solo se usa para cuentas locales. Sin contraseña en ing039 no se puede entrar. Bajas: `users.Baja` (fecha; NULL = activo). Quien tiene Baja no entra ni se le puede asignar nada; sus equipos salen como "libres próximamente" (motivo: baja) en Disponibilidad y en el panel (`bajas_con_equipos`). Una Baja no cuenta si la persona tiene otra fila activa con el mismo Resid o email.
2. Actas en PDF (PDFKit) para entrega y devolución.
3. Pantallas: personas (consulta de ING039 y equipos a recoger por baja), masterización, incidencias, solicitudes, catálogos. Las altas y bajas de personas se hacen en ING039.
4. Alertas diarias (`node-cron` + email).
5. Importación inicial desde Excel.
