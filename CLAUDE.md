# CLAUDE.md — contexto para seguir trabajando en este repo

## Qué es

Inventario IT para una empresa de ingeniería (CT Ingenieros). Spec: `docs/especificacion.md` (versión viva en Claude Docs: https://claude.ai/code/artifact/1b9daf29-c98c-4326-b3d8-c61db22dfbf9).

## Convenciones

- Idioma: código, comentarios, UI y BD en **español**.
- Backend: Express 4 + `mysql2/promise`. Siempre sentencias preparadas (`query(sql, params)` en `server/src/db.js`). `LIMIT/OFFSET` se interpolan solo tras validarlos como enteros (`paginacion()`).
- Toda operación que cambia equipos o asignaciones va en `transaction()` y llama a `auditar()`.
- Cambios de estado de equipo: validar con `server/src/lib/estados.js`.
- Control de ámbito siempre en servidor (`ambito()` en `middleware/auth.js`): IT ve todo; responsable su UN/proyecto; empleado sus equipos.
- Frontend: HTML + JS vanilla, **sin scripts en línea** (CSP de helmet). Cada página carga `/js/api.js` y su `/js/pages/<pagina>.js`. Escapar siempre con `esc()`.
- Al añadir páginas o JS, añadirlos a `SHELL` en `public/sw.js` y subir `VERSION`.

## Entorno

- Desarrollo en el ordenador de Deni (Windows + XAMPP). Más adelante se moverá a una máquina virtual.
- Montado y probado en local con MariaDB 10.4 de XAMPP (BD `inventario_it`). Arranque: `.claude/launch.json` o `npm --prefix server run dev`.
- Usuarios: se leen de la BD corporativa `ing039` (volcado en `BBDD/`, fuera de git; importar con `mysql -uroot ing039 < BBDD/ING039_*.sql`). Nunca se escribe en ella; todo lo demás va en `inventario_it`.

## Pendiente inmediato

1. ~~Base de datos de usuarios~~ Hecho: login contra `ing039.users` (argon2id, por email o `WindowsUser`; `AUTH_DB_NAME` en `.env`). Cada login refleja el usuario en `usuarios`/`empleados` (`auth_origen='ing039'`, sin contraseña) y resincroniza el rol: Admin→`admin_it`, Project Manager→`responsable` de su BU, Reader→`lector` (ve todo, no modifica), FTE/sin rol→`empleado`. Ver `server/src/lib/usuarios-ing039.js`. Los usuarios sin contraseña en ing039 no pueden entrar.
2. Actas en PDF (PDFKit) para entrega y devolución.
3. Pantallas: empleados (altas y bajas), masterización, incidencias, solicitudes, catálogos.
4. Alertas diarias (`node-cron` + email).
5. Importación inicial desde Excel.
