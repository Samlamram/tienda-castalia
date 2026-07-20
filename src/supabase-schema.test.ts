import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(join(process.cwd(), 'supabase', 'schema.sql'), 'utf8');
const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '202607140001_rebuild_professional_schema.sql'),
  'utf8'
);
const financeMigration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '202607140002_finance_module.sql'),
  'utf8'
);
const priceHistoryMigration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '202607140003_product_price_history.sql'),
  'utf8'
);
const productImagesMigration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '202607160001_product_images_storage.sql'),
  'utf8'
);
const userAccountActivityMigration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '202607180001_user_account_activity.sql'),
  'utf8'
);
const consumptionVoidRequestsMigration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '202607190001_consumption_void_requests.sql'),
  'utf8'
);
const sheetsWebhooks = readFileSync(
  join(process.cwd(), 'supabase', 'apps-script-webhooks.sql'),
  'utf8'
);
const appsScript = readFileSync(join(process.cwd(), 'apps-script', 'Code.gs'), 'utf8');
const reportsScript = readFileSync(join(process.cwd(), 'apps-script', 'Reports.gs'), 'utf8');

function capturedNames(pattern: RegExp): string[] {
  return [...schema.matchAll(pattern)].map((match) => match[1]).sort();
}

describe('contrato del esquema oficial', () => {
  it('mantiene exactamente las 14 tablas y las 5 vistas aprobadas', () => {
    expect(capturedNames(/create table public\.([a-z_]+)/gi)).toEqual([
      'accounts',
      'app_sessions',
      'app_users',
      'audit_log',
      'consumption_items',
      'consumption_void_requests',
      'consumptions',
      'fifo_cost_allocations',
      'financial_movements',
      'inventory_movements',
      'payment_applications',
      'product_price_history',
      'products',
      'store_finance_events'
    ]);
    expect(capturedNames(/create view public\.([a-z_]+)/gi)).toEqual([
      'account_balances',
      'consumption_costs',
      'consumption_payment_status',
      'product_stock',
      'user_balances'
    ]);
  });

  it('protege todas las tablas y expone solo las RPC autorizadas', () => {
    const tables = capturedNames(/create table public\.([a-z_]+)/gi);
    expect(capturedNames(/alter table public\.([a-z_]+) enable row level security/gi)).toEqual(tables);
    expect(capturedNames(/revoke all on table public\.([a-z_]+) from public, anon, authenticated/gi)).toEqual([
      ...tables,
      'account_balances',
      'consumption_costs',
      'consumption_payment_status',
      'product_stock',
      'user_balances'
    ].sort());
    for (const rpc of [
      'login_pin',
      'logout_session',
      'change_my_pin',
      'get_user_catalog',
      'create_consumption',
      'get_user_account_activity',
      'request_consumption_void',
      'get_consumption_void_requests',
      'admin_review_consumption_void_request',
      'admin_get_snapshot',
      'admin_command',
      'admin_get_audit_log',
      'admin_get_finance_events',
      'admin_finance_command',
      'admin_get_product_price_history'
    ]) {
      expect(schema).toMatch(new RegExp(`grant execute on function public\\.${rpc}\\(`, 'i'));
    }
  });

  it('no conserva la exportacion manual de Google Sheets', () => {
    expect(schema).not.toMatch(/create or replace function public\.admin_get_export_data/i);
    expect(schema).not.toMatch(/create or replace function public\.app_filter_json_by_date/i);
    expect(schema).not.toMatch(/grant execute on function public\.admin_get_export_data/i);
  });

  it('respalda por webhook cada tabla oficial y filtra secretos en Apps Script', () => {
    const tables = capturedNames(/create table public\.([a-z_]+)/gi);
    for (const table of tables) {
      expect(sheetsWebhooks).toMatch(
        new RegExp(`create trigger backup_${table}_to_sheets[\\s\\S]*?on public\\.${table}`, 'i')
      );
      expect(appsScript).toMatch(new RegExp(`'${table}'`));
    }
    expect(sheetsWebhooks.match(/after insert or update or delete/gi)).toHaveLength(tables.length);
    expect(appsScript).toMatch(/SENSITIVE_KEY\s*=\s*\/\(pin\|token\|hash\|salt\|secret\|password\)\/i/);
    expect(appsScript).toMatch(/const EVENT_SHEET = '_eventos'/);
  });

  it('incluye inversion, gastos y retiros en los reportes financieros', () => {
    expect(reportsScript).toMatch(/readRawTable_\(spreadsheet, 'store_finance_events'\)/);
    expect(reportsScript).toMatch(/'Finanzas'/);
    expect(reportsScript).toMatch(/capital_contribution:\s*'INVERSIÓN'/);
    expect(reportsScript).toMatch(/owner_withdrawal:\s*'RETIRO'/);
    expect(reportsScript).toMatch(/writeKpiCard_\([\s\S]*?'Gastos del mes'/);
    expect(reportsScript).toMatch(/'Utilidad neta'/);
    expect(reportsScript).toMatch(/'Flujo neto del mes'/);
    expect(reportsScript).toMatch(/function createDashboardCharts_/);
    expect(reportsScript).toMatch(/'Alertas de inventario'/);
    expect(reportsScript).toMatch(/Charts\.ChartType\.WATERFALL/);
    expect(reportsScript).toMatch(/'Top productos'/);
    expect(reportsScript).toMatch(/'Top cuentas'/);
    expect(reportsScript).toMatch(/'Top usuarios'/);
    expect(reportsScript).toMatch(/function refreshReportsFromButton\(\)/);
    expect(reportsScript).toMatch(/assignScript\('refreshReportsFromButton'\)/);
    expect(reportsScript).toMatch(/'Estado de resultados · '/);
    expect(reportsScript).toMatch(/'Evolución mensual'/);
  });

  it('conserva idempotencia offline y elimina secretos de la auditoria', () => {
    expect(schema).toMatch(/client_operation_id uuid not null unique/i);
    expect(schema).toMatch(/create or replace function public\.app_redact_json/i);
    for (const secret of ['pin_hash', 'pin_salt', 'token_hash', 'session_token', 'access_token', 'refresh_token']) {
      expect(schema).toMatch(new RegExp(`'${secret}'`, 'i'));
    }
    expect(schema).toMatch(/'pin_changed'/i);
  });

  it('limita la actividad de usuario a su cuenta o a su propio usuario independiente', () => {
    expect(userAccountActivityMigration).toMatch(/v_user\s*:=\s*public\.app_current_user\(p_session_token\)/i);
    expect(userAccountActivityMigration).toMatch(/v_user\.account_id is not null and c\.account_id = v_user\.account_id/i);
    expect(userAccountActivityMigration).toMatch(/v_user\.account_id is null and c\.user_id = v_user\.id/i);
    expect(userAccountActivityMigration).toMatch(/v_user\.account_id is null and u\.id = v_user\.id/i);
    expect(userAccountActivityMigration).toMatch(/consumptionPaymentStatuses/i);
    expect(userAccountActivityMigration).not.toMatch(/pin_hash|pin_salt|token_hash/i);
    expect(userAccountActivityMigration).toMatch(
      /grant execute on function public\.get_user_account_activity\(text, integer\) to anon, authenticated/i
    );
  });

  it('mantiene la migracion reproducible sincronizada con schema.sql', () => {
    expect(schema.trim()).toBe(
      `${migration.trim()}\n\n${financeMigration.trim()}\n\n${priceHistoryMigration.trim()}\n\n${productImagesMigration.trim()}\n\n${userAccountActivityMigration.trim()}\n\n${consumptionVoidRequestsMigration.trim()}`
    );
  });
});
