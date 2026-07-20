-- Respaldo asincrono Supabase -> Apps Script -> Google Sheets.
-- Ejecutar despues de desplegar apps-script/Code.gs como Web App.
-- Reemplazar en todo el archivo:
--   APPS_SCRIPT_WEB_APP_URL  -> URL terminada en /exec
--   BACKUP_WEBHOOK_TOKEN     -> mismo WEBHOOK_TOKEN de Apps Script

create extension if not exists pg_net with schema extensions;

create or replace function public.app_backup_to_sheets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  payload := jsonb_build_object(
    'type', tg_op,
    'table', tg_table_name,
    'schema', tg_table_schema,
    'record', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    'old_record', case when tg_op = 'INSERT' then null else to_jsonb(old) end
  );

  perform net.http_post(
    url := 'APPS_SCRIPT_WEB_APP_URL?webhook_key=BACKUP_WEBHOOK_TOKEN',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := payload,
    timeout_milliseconds := 10000
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.app_backup_to_sheets() from public, anon, authenticated;

drop trigger if exists backup_accounts_to_sheets on public.accounts;
create trigger backup_accounts_to_sheets after insert or update or delete on public.accounts
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_app_users_to_sheets on public.app_users;
create trigger backup_app_users_to_sheets after insert or update or delete on public.app_users
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_app_sessions_to_sheets on public.app_sessions;
create trigger backup_app_sessions_to_sheets after insert or update or delete on public.app_sessions
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_products_to_sheets on public.products;
create trigger backup_products_to_sheets after insert or update or delete on public.products
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_product_price_history_to_sheets on public.product_price_history;
create trigger backup_product_price_history_to_sheets after insert or update or delete on public.product_price_history
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_consumptions_to_sheets on public.consumptions;
create trigger backup_consumptions_to_sheets after insert or update or delete on public.consumptions
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_consumption_items_to_sheets on public.consumption_items;
create trigger backup_consumption_items_to_sheets after insert or update or delete on public.consumption_items
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_consumption_void_requests_to_sheets on public.consumption_void_requests;
create trigger backup_consumption_void_requests_to_sheets after insert or update or delete on public.consumption_void_requests
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_financial_movements_to_sheets on public.financial_movements;
create trigger backup_financial_movements_to_sheets after insert or update or delete on public.financial_movements
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_payment_applications_to_sheets on public.payment_applications;
create trigger backup_payment_applications_to_sheets after insert or update or delete on public.payment_applications
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_inventory_movements_to_sheets on public.inventory_movements;
create trigger backup_inventory_movements_to_sheets after insert or update or delete on public.inventory_movements
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_fifo_cost_allocations_to_sheets on public.fifo_cost_allocations;
create trigger backup_fifo_cost_allocations_to_sheets after insert or update or delete on public.fifo_cost_allocations
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_audit_log_to_sheets on public.audit_log;
create trigger backup_audit_log_to_sheets after insert or update or delete on public.audit_log
for each row execute function public.app_backup_to_sheets();

drop trigger if exists backup_store_finance_events_to_sheets on public.store_finance_events;
create trigger backup_store_finance_events_to_sheets after insert or update or delete on public.store_finance_events
for each row execute function public.app_backup_to_sheets();
