# Respaldo automático Supabase → Google Sheets

Cada `INSERT`, `UPDATE` o `DELETE` confirmado en las 11 tablas oficiales genera un Database Webhook asíncrono. El Web App de Apps Script conserva dos representaciones:

- `_eventos`: historial append-only, deduplicado por SHA-256 del payload.
- una pestaña por tabla: espejo del último estado de cada fila; los borrados quedan marcados como `DELETED`.

Los campos cuyo nombre contiene `pin`, `token`, `hash`, `salt`, `secret` o `password` se reemplazan por `[REDACTED]` antes de escribirlos.

## Configuración

1. Crea la hoja de respaldo y copia su ID.
2. Crea un proyecto de Apps Script, pega `Code.gs` y usa el manifest `appsscript.json`.
3. En **Configuración del proyecto → Propiedades del script**, crea:
   - `SPREADSHEET_ID`: ID de la hoja.
   - `WEBHOOK_TOKEN`: secreto aleatorio largo y exclusivo para este respaldo.
4. Ejecuta `setupBackup` una vez y autoriza el acceso a la hoja.
5. Despliega como **Aplicación web**, ejecutando como el propietario y permitiendo acceso a cualquiera que tenga la URL. Usa siempre la URL `/exec`, no `/dev`.
6. Reemplaza `APPS_SCRIPT_WEB_APP_URL` y `BACKUP_WEBHOOK_TOKEN` en `../supabase/apps-script-webhooks.sql` y ejecuta el SQL en Supabase.
7. Crea o modifica una fila de prueba y confirma que aparece tanto en `_eventos` como en la pestaña de su tabla.

Para revisar entregas fallidas, consulta los registros de Database Webhooks en Supabase y las ejecuciones del proyecto de Apps Script. Esta copia es un respaldo secundario y no sustituye los backups/PITR de PostgreSQL.
