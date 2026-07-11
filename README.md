# App Tienda

PWA para una tienda/casa con dos modos:

- **Local/demo:** datos completos en IndexedDB para trabajar offline sin Supabase.
- **Cloud:** usuarios con catalogo offline liviano, compras pendientes por dispositivo y admin multi-dispositivo con operaciones transaccionales en Supabase.

## Arranque Local

```bash
npm install
npm run dev
```

Datos demo:

- PIN usuarios: `1234`
- PIN admin: `0000`
- Sin variables de Supabase, la app carga la demo local completa.
- Con Supabase configurado, la app no siembra demo en dispositivos nuevos; inicia sesion contra `login_pin` y cachea solo lo necesario.

## Variables

Copia `.env.example` a `.env` si vas a conectar nube/exportacion:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_EXPORT_FUNCTION_URL=
VITE_DEFAULT_SHEET_ID=
```

Sin `VITE_EXPORT_FUNCTION_URL`, la exportacion descarga un JSON local con las pestanas que se enviarian a Google Sheets.

## Supabase

1. Crea un proyecto en Supabase.
2. Ejecuta `supabase/schema.sql`.
3. Crea una cuenta y usuario admin con el bloque de bootstrap comentado al final del schema.
4. Publica la funcion `supabase/functions/export-to-sheets` si necesitas exportar a Google Sheets.
5. Configura secretos de la funcion:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
6. Comparte el Google Sheet con el email del service account.

RPCs principales:

- `login_pin`: valida usuario + PIN y entrega sesion de app.
- `get_user_catalog`: devuelve catalogo versionado, cuenta y saldo propio.
- `create_consumption`: registra compras con `clientOperationId` idempotente.
- `admin_get_snapshot`: refresca el cache completo del admin.
- `admin_command`: ejecuta mutaciones admin con audit log e idempotencia.
- `recalculate_fifo_costs`: recalcula costos FIFO de forma idempotente.

`sync_operations` queda como compatibilidad del modo local/v1; no es la ruta principal para produccion multi-dispositivo.

## Flujos Cubiertos

- Usuario inicia sesion con PIN online, cachea catalogo y puede navegarlo offline.
- Compra sin conexion queda como `pending` y se reintenta al reconectar.
- El celular de usuario no descarga otros usuarios, pagos globales ni historial completo.
- Admin crea/edita cuentas, usuarios y productos mediante RPC transaccional.
- Admin registra pagos con bloqueo por cuenta para evitar doble aplicacion.
- Inventario y anulaciones generan movimientos; FIFO se recalcula despues en servidor.
- Imagenes del catalogo se cargan lazy y el service worker las cachea con `CacheFirst`.

## Comandos

```bash
npm run lint
npm run test
npm run build
```
