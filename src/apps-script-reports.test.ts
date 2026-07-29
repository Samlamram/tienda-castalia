import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type ReportSource = Record<string, Array<Record<string, unknown>>>;

type ReportApi = {
  buildConsumptionRows_: (source: ReportSource) => unknown[][];
  buildPurchaseRows_: (source: ReportSource) => unknown[][];
  buildCashReport_: (source: ReportSource) => {
    summary: unknown[][];
    movements: unknown[][];
  };
  readRawTable_: (
    spreadsheet: {
      getSheetByName: (name: string) => {
        getLastRow: () => number;
        getLastColumn: () => number;
        getRange: () => { getValues: () => unknown[][] };
      };
    },
    name: string
  ) => Array<Record<string, unknown>>;
};

const reportsScript = readFileSync(
  join(process.cwd(), 'apps-script', 'Reports.gs'),
  'utf8'
);
const reports = new Function(
  'EVENT_SHEET',
  `${reportsScript}; return { buildConsumptionRows_, buildPurchaseRows_, buildCashReport_, readRawTable_ };`
)('_eventos') as ReportApi;

function sampleSource(): ReportSource {
  return {
    users: [{ id: 'user-1', name: 'Ana' }],
    products: [{ id: 'product-1', name: 'Pan' }],
    consumptions: [{
      id: 'consumption-1',
      user_id: 'user-1',
      total: 20,
      status: 'confirmed',
      created_at: '2026-07-28T12:00:00.000Z'
    }],
    items: [{
      id: 'item-1',
      consumption_id: 'consumption-1',
      product_id: 'product-1',
      quantity: 2,
      unit_price: 10,
      total: 20
    }],
    movements: [{
      id: 'payment-1',
      movement_type: 'payment',
      user_id: 'user-1',
      amount: 20,
      created_at: '2026-07-28T12:30:00.000Z'
    }],
    applications: [{ consumption_id: 'consumption-1', amount: 20 }],
    inventoryMovements: [{
      id: 'purchase-1',
      product_id: 'product-1',
      movement_type: 'purchase',
      quantity_delta: 5,
      unit_cost: 3,
      created_at: '2026-07-28T10:00:00.000Z'
    }],
    financeEvents: [
      {
        id: 'capital-1',
        event_type: 'capital_contribution',
        amount: 100,
        created_at: '2026-07-28T09:00:00.000Z'
      },
      {
        id: 'expense-1',
        event_type: 'expense',
        amount: 10,
        created_at: '2026-07-28T11:00:00.000Z'
      }
    ]
  };
}

describe('reportes simples de Google Sheets', () => {
  it('genera consumos, compras y caja con los campos operativos', () => {
    const source = sampleSource();

    expect(reports.buildConsumptionRows_(source)).toEqual([
      ['Ana', 2, 'Pan', expect.any(Date), 20, 'SÍ']
    ]);
    expect(reports.buildPurchaseRows_(source)).toEqual([
      [expect.any(Date), 'Pan', 5, 3, 15]
    ]);
    expect(reports.buildCashReport_(source).summary).toEqual([
      ['Inversión', 100],
      ['Cobros recibidos', 20],
      ['Compras', 15],
      ['Gastos', 10],
      ['Retiros', 0],
      ['Caja actual', 95]
    ]);
  });

  it('excluye del reporte los registros eliminados del espejo', () => {
    const values = [
      ['_backup_status', 'id', 'name'],
      ['ACTIVE', 'user-1', 'Ana'],
      ['DELETED', 'user-2', 'Cuenta vieja']
    ];
    const spreadsheet = {
      getSheetByName: () => ({
        getLastRow: () => values.length,
        getLastColumn: () => values[0].length,
        getRange: () => ({ getValues: () => values })
      })
    };

    expect(reports.readRawTable_(spreadsheet, 'app_users')).toEqual([
      { _backup_status: 'ACTIVE', id: 'user-1', name: 'Ana' }
    ]);
  });
});
