# Respaldo y reportes Supabase → Google Sheets

Cada `INSERT`, `UPDATE` o `DELETE` confirmado en las 12 tablas oficiales se envía de forma asíncrona mediante `pg_net`. Apps Script mantiene:

- `_eventos`: historial técnico deduplicado por SHA-256.
- una pestaña oculta por tabla: espejo del estado más reciente.
- `Resumen`, `Ventas`, `Cobros`, `Compras_Gastos`, `Finanzas` e `Inventario`: vistas simples para análisis financiero.

Los campos cuyo nombre contiene `pin`, `token`, `hash`, `salt`, `secret` o `password` se reemplazan por `[REDACTED]` antes de escribirlos.

## Uso diario

La información base llega casi en tiempo real. Después de recargar la hoja, el menú superior **🔄 Actualizar → Actualizar reporte ahora** recalcula todos los reportes. El menú **Tienda → Actualizar reporte** queda como alternativa técnica. En escritorio también puede usarse una imagen o dibujo con la función `refreshReportsFromButton` asignada.

El dashboard se organiza como un estado financiero: ventas, costo FIFO, utilidad bruta, gastos y utilidad neta del mes. También muestra la evolución de todos los meses, caja, waterfall financiero, rankings de productos, cuentas y usuarios, y alertas operativas. Inversión, gastos y retiros permanecen separados para no mezclar caja con utilidad.

## Instalación reproducible

1. Vincula este directorio con un proyecto de Apps Script ligado a la hoja y publica el Web App ejecutando como el propietario, con acceso anónimo mediante su URL secreta.
2. Configura `SPREADSHEET_ID` y `WEBHOOK_TOKEN` como propiedades del script, o en un `Config.gs` local ignorado por Git.
3. Ejecuta `setupBackup` una vez para autorizar y crear la estructura inicial.
4. Sustituye los marcadores de `../supabase/apps-script-webhooks.sql` y ejecútalo en Supabase.
5. Para una migración histórica, envía por tabla un payload autenticado `SNAPSHOT` con `schema`, `table` y `records`.

Los webhooks son asíncronos: una demora o caída de Sheets no bloquea una venta en PostgreSQL. Esta copia ayuda al análisis y respaldo secundario, pero no reemplaza los backups/PITR de Supabase.
