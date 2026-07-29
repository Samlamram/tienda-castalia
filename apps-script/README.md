# Respaldo y reportes Supabase → Google Sheets

Cada `INSERT`, `UPDATE` o `DELETE` confirmado en las 12 tablas oficiales se envía de forma asíncrona mediante `pg_net`. Apps Script mantiene:

- `_eventos`: historial técnico deduplicado por SHA-256.
- una pestaña oculta por tabla: espejo del estado más reciente.
- `Consumos`: usuario, cantidad, producto consumido, fecha, precio y estado de cobro.
- `Compras`: listado básico de compras de inventario.
- `Caja`: inversión, cobros, compras, gastos, retiros y saldo de caja, con un listado sencillo de movimientos.

Los campos cuyo nombre contiene `pin`, `token`, `hash`, `salt`, `secret` o `password` se reemplazan por `[REDACTED]` antes de escribirlos.

## Uso diario

La información base llega casi en tiempo real. El menú superior **Tienda → Actualizar listados** vuelve a generar las tres pestañas de uso diario. Las tablas técnicas del respaldo permanecen ocultas y pueden mostrarse desde el mismo menú cuando sea necesario revisar el respaldo.

La hoja está pensada para operación diaria, no para análisis contable avanzado. Las pestañas antiguas de reportes complejos se ocultan automáticamente al actualizar.

## Instalación reproducible

1. Vincula este directorio con un proyecto de Apps Script ligado a la hoja y publica el Web App ejecutando como el propietario, con acceso anónimo mediante su URL secreta.
2. Configura `SPREADSHEET_ID` y `WEBHOOK_TOKEN` como propiedades del script, o en un `Config.gs` local ignorado por Git.
3. Ejecuta `setupBackup` una vez para autorizar y crear la estructura inicial.
4. Sustituye los marcadores de `../supabase/apps-script-webhooks.sql` y ejecútalo en Supabase.
5. Para una migración histórica, envía por tabla un payload autenticado `SNAPSHOT` con `schema`, `table` y `records`.

Los webhooks son asíncronos: una demora o caída de Sheets no bloquea una venta en PostgreSQL. Esta copia ayuda al análisis y respaldo secundario, pero no reemplaza los backups/PITR de Supabase.
