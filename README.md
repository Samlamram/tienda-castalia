# App Tienda

PWA para consumos, cuentas compartidas e inventario. Supabase es la única fuente oficial; el navegador conserva únicamente sesión, catálogo, configuración y compras pendientes para permitir compras sin conexión.

## Arranque

```bash
npm install
npm run dev
```

Copia `.env.example` a `.env` y configura como mínimo:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

La administración requiere internet. Los usuarios con sesión personal pueden consultar el catálogo y registrar compras sin conexión; la cola se reintenta con un UUID idempotente al recuperar la red.

## Base de datos

`supabase/schema.sql` recrea el esquema v2 desde cero. Es destructivo porque el modelo anterior contenía únicamente datos demo. El modelo tiene 11 tablas:

- `accounts`, `app_users`, `app_sessions`, `products`
- `consumptions`, `consumption_items`
- `financial_movements`, `payment_applications`
- `inventory_movements`, `fifo_cost_allocations`
- `audit_log`

Stock, costos FIFO, saldos y estado de pago se consultan mediante vistas. Los registros comerciales son inmutables y cualquier corrección se representa con una anulación o movimiento inverso.

Aplicación inicial:

1. Ejecuta `supabase/schema.sql` o la migración base de `supabase/migrations`.
2. Ejecuta `supabase/seed.sql` para cargar la demostración repetible.
3. Si necesitas el respaldo secundario en Google Sheets, despliega `apps-script/Code.gs` como Web App.
4. Configura sus propiedades `SPREADSHEET_ID` y `WEBHOOK_TOKEN`.
5. Sustituye los marcadores y ejecuta `supabase/apps-script-webhooks.sql`.

Datos del seed:

- Administrador: `admin` / `0000`
- Usuarios demo: PIN `1234`

Estas credenciales son solo para desarrollo. Antes de publicar, entra como administrador y usa el botón de llave del encabezado para cambiar el PIN temporal.

RPC principales:

- `login_pin`, `logout_session`, `change_my_pin`
- `get_user_catalog`, `create_consumption`
- `admin_get_snapshot`, `admin_get_audit_log`
- `admin_command`

Las tablas tienen RLS y permisos directos revocados. Los clientes operan únicamente mediante RPC. La auditoría automática registra actor, solicitud, dispositivo, motivo y valores anterior/nuevo; excluye PIN, hashes, salts y tokens.

Las operaciones masivas de productos se ejecutan en una sola transacción e idempotency key. Si una fila falla, PostgreSQL revierte el lote completo. Los pagos, ajustes e inventario se corrigen mediante movimientos inversos enlazados; nunca se elimina físicamente un registro comercial.

## Base local

IndexedDB usa `app_tienda_v2` con exactamente cuatro stores:

- `appSessions`
- `catalogProducts`
- `pendingConsumptions`
- `settings`

Al abrir v2 se elimina de forma idempotente la antigua `app_tienda_v1`. Los snapshots administrativos nunca se persisten localmente.

Una compra rechazada por una causa permanente queda visible como “requiere revisión”; el usuario puede reintentarla tras corregir la causa o descartar únicamente el intento local no confirmado. Una sesión vencida conserva la compra como pendiente para el siguiente inicio de sesión del mismo usuario.

## Respaldo en Google Sheets

Sheets funciona como respaldo secundario automático, no como fuente de datos ni como exportación manual desde el navegador. Los Database Webhooks de Supabase envían cada `INSERT`, `UPDATE` y `DELETE` confirmado al Web App de Apps Script de manera asíncrona.

El script mantiene un historial append-only en `_eventos` y un espejo por tabla. Deduplica entregas repetidas, marca los borrados y elimina secretos antes de escribir. La instalación completa está documentada en `apps-script/README.md`.

## Verificación

```bash
npm run lint
npm run test
npm run build
```
