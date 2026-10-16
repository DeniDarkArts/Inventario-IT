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
- Nada se ha ejecutado todavía contra MySQL real: el esquema y el servidor se escribieron sin poder instalar dependencias. **Primer paso**: `npm install`, `npm run db:schema`, `npm run db:seed`, `npm run crear-admin`, `npm run dev`, y corregir lo que falle.

## Pendiente inmediato

1. **Base de datos de usuarios existente**: ya existe una BD con una tabla de usuarios. Deni pasará los datos (servidor, nombre de BD, tabla, columnas, cómo guarda las contraseñas). Hay que decidir si:
   - la app autentica contra esa tabla (adaptar `server/src/routes/auth.js` y, si es otra BD, un segundo pool en `db.js`), o
   - se sincronizan/importan esos usuarios a `usuarios` + `empleados`.
   El resto del código solo depende de `req.session.user = { id, empleado_id, email, roles: [{rol, un_id, proyecto_id}] }`; mantener ese contrato.
2. Actas en PDF (PDFKit) para entrega y devolución.
3. Pantallas: empleados (altas y bajas), masterización, incidencias, solicitudes, catálogos.
4. Alertas diarias (`node-cron` + email).
5. Importación inicial desde Excel.
