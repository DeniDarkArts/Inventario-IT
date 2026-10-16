# Inventario IT

Gestión del inventario de equipos informáticos (portátiles, PCs, monitores, docks, teclados…) de una empresa de ingeniería cuyos empleados trabajan en la oficina o en instalaciones de clientes.

- Asignación de equipos por **persona, proyecto y BU** (con equipos compartidos entre BU).
- **Disponibilidad**: qué equipos están libres ahora, tras preparación o próximamente.
- Entrega y devolución de equipos firmadas. Las personas, sus BU, oficinas y bajas se leen en vivo de ING039.
- **Masterización** interna o en el dominio del cliente.
- **Incidencias** con fotos, sustitutos y reparación.
- **PWA móvil** con escaneo de la pegatina QR.

Especificación completa: [`docs/especificacion.md`](docs/especificacion.md).

## Stack

HTML + CSS + JavaScript vanilla · Node.js 20+ con Express · MySQL 8 (XAMPP en desarrollo) · PWA instalable en Android.

## Estructura

```
database/   schema.sql (16 tablas + vista de disponibilidad) y seed.sql (datos de ejemplo)
docs/       especificación técnica
server/     API REST Express (src/routes/*) y scripts de BD
public/     web de escritorio y PWA (HTML + JS por página, manifest y service worker)
uploads/    fotos de incidencias y firmas (no se versiona)
```

## Puesta en marcha en local (Windows + XAMPP)

1. Arranca **MySQL** desde el panel de XAMPP.
2. Instala Node.js 20 LTS o superior.
3. En una terminal:

   ```bash
   cd server
   copy .env.example .env      # en Linux/Mac: cp .env.example .env
   npm install
   npm run db:schema           # crea la base de datos inventario_it
   npm run db:seed             # (opcional) datos de ejemplo
   npm run crear-admin -- admin@empresa.es UnaContraseñaLarga
   npm run dev
   ```

4. Abre <http://localhost:3000> y entra con el administrador creado.

## Probar la PWA en el móvil

La cámara del navegador solo funciona con **HTTPS** (o `localhost`). Para probar desde un Android en la misma red, publica el puerto con un túnel HTTPS (por ejemplo `cloudflared tunnel --url http://localhost:3000`) o configura un certificado en el servidor. Después, en Chrome Android: menú → *Instalar aplicación*.

Los QR de las pegatinas deben contener `<PUBLIC_URL>/q/<código>`, por ejemplo `https://inventario.empresa.es/q/CT-000123`; también se acepta el código solo.

## Estado

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1. Base | Esquema, catálogos, login, alta y ficha de equipos, inventario | Esqueleto hecho |
| 2. Asignaciones y PWA | Asignar, devolver, cambio de proyecto, firmas, escáner QR, disponibilidad | Esqueleto hecho; falta acta PDF |
| 3. Ciclo completo | Altas y bajas, masterización, incidencias, solicitudes, alertas | API básica hecha; faltan pantallas y alertas por email |
| 4. Mejoras | KPIs, informes Excel, inventario físico, Entra ID | Pendiente |

## Pendiente de decidir

- Integrar el login con la **base de datos de usuarios existente** (ver `CLAUDE.md`).
- Preguntas abiertas de la especificación.
