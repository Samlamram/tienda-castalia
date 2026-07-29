const REPORT_TIME_ZONE = 'America/Bogota';
const REPORT_SHEETS = ['Consumos', 'Compras', 'Caja'];
const LEGACY_REPORT_SHEETS = ['Resumen', 'Ventas', 'Cobros', 'Compras_Gastos', 'Finanzas', 'Inventario'];
const RAW_SHEETS = [
  EVENT_SHEET,
  'accounts',
  'app_users',
  'app_sessions',
  'products',
  'product_price_history',
  'consumptions',
  'consumption_items',
  'financial_movements',
  'payment_applications',
  'inventory_movements',
  'fifo_cost_allocations',
  'store_finance_events',
  'audit_log',
  '_dashboard_data'
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tienda')
    .addItem('Actualizar listados', 'refreshReportsFromButton')
    .addSeparator()
    .addItem('Mostrar datos técnicos', 'showRawSheets')
    .addItem('Ocultar datos técnicos', 'hideRawSheets')
    .addToUi();
}

function refreshReportsFromButton() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  spreadsheet.toast('Actualizando listados…', 'App Tienda', 30);
  const result = refreshReports();
  spreadsheet.toast('Listados actualizados.', 'App Tienda', 5);
  return result;
}

function refreshReports() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(getConfig_().spreadsheetId);
    const source = loadReportSource_(spreadsheet);
    const consumptions = buildConsumptionRows_(source);
    const purchases = buildPurchaseRows_(source);
    const cash = buildCashReport_(source);

    writeReportTable_(
      spreadsheet,
      'Consumos',
      ['Usuario', 'Cantidad', 'Qué comió', 'Fecha', 'Precio', 'Cobrado'],
      consumptions
    );
    writeReportTable_(
      spreadsheet,
      'Compras',
      ['Fecha', 'Producto', 'Cantidad', 'Precio unitario', 'Total'],
      purchases
    );
    writeCashSheet_(spreadsheet, cash);
    hideSheets_(spreadsheet, RAW_SHEETS.concat(LEGACY_REPORT_SHEETS));
    SpreadsheetApp.flush();

    return {
      ok: true,
      consumptionRows: consumptions.length,
      purchaseRows: purchases.length,
      cashMovementRows: cash.movements.length
    };
  } finally {
    lock.releaseLock();
  }
}

function getDashboardStatus() {
  const spreadsheet = SpreadsheetApp.openById(getConfig_().spreadsheetId);
  return {
    ok: true,
    reports: REPORT_SHEETS.reduce(function (result, name) {
      const sheet = spreadsheet.getSheetByName(name);
      result[name] = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
      return result;
    }, {})
  };
}

function loadReportSource_(spreadsheet) {
  return {
    users: readRawTable_(spreadsheet, 'app_users'),
    products: readRawTable_(spreadsheet, 'products'),
    consumptions: readRawTable_(spreadsheet, 'consumptions'),
    items: readRawTable_(spreadsheet, 'consumption_items'),
    movements: readRawTable_(spreadsheet, 'financial_movements'),
    applications: readRawTable_(spreadsheet, 'payment_applications'),
    inventoryMovements: readRawTable_(spreadsheet, 'inventory_movements'),
    financeEvents: readRawTable_(spreadsheet, 'store_finance_events')
  };
}

function buildConsumptionRows_(source) {
  const users = indexBy_(source.users, 'id');
  const products = indexBy_(source.products, 'id');
  const consumptions = indexBy_(source.consumptions, 'id');
  const paidByConsumption = sumBy_(source.applications, 'consumption_id', 'amount');

  return source.items
    .map(function (item) {
      const consumption = consumptions[String(item.consumption_id)] || {};
      const user = users[String(item.user_id || consumption.user_id)] || {};
      const product = products[String(item.product_id)] || {};
      const quantity = number_(item.quantity);
      const price = number_(item.total) || quantity * number_(item.unit_price);
      const consumptionTotal = Math.max(0, number_(consumption.total));
      const paid = Math.max(0, number_(paidByConsumption[String(consumption.id)]));
      const status = String(consumption.status || 'confirmed');
      let paymentStatus = 'NO';

      if (status === 'voided') {
        paymentStatus = 'ANULADO';
      } else if (consumptionTotal > 0 && paid >= consumptionTotal - 0.01) {
        paymentStatus = 'SÍ';
      } else if (paid > 0) {
        paymentStatus = 'PARCIAL';
      }

      return [
        String(user.name || 'Sin usuario'),
        quantity,
        String(item.product_name || product.name || 'Sin producto'),
        dateCell_(item.created_at || consumption.created_at),
        roundMoney_(price),
        paymentStatus
      ];
    })
    .sort(function (left, right) { return timeValue_(right[3]) - timeValue_(left[3]); });
}

function buildPurchaseRows_(source) {
  const products = indexBy_(source.products, 'id');
  const movements = indexBy_(source.inventoryMovements, 'id');

  return source.inventoryMovements
    .filter(function (movement) {
      const type = String(movement.movement_type || '');
      if (type === 'purchase') return true;
      const original = movements[String(movement.reversed_movement_id || '')] || {};
      return type === 'adjustment_reversal' && String(original.movement_type || '') === 'purchase';
    })
    .map(function (movement) {
      const original = movements[String(movement.reversed_movement_id || '')] || {};
      const product = products[String(movement.product_id || original.product_id)] || {};
      const quantity = number_(movement.quantity_delta);
      const unitCost = nullableNumber_(movement.unit_cost);
      const originalUnitCost = nullableNumber_(original.unit_cost);
      const resolvedUnitCost = unitCost === null ? number_(originalUnitCost) : unitCost;
      return [
        dateCell_(movement.created_at),
        String(product.name || 'Sin producto'),
        quantity,
        roundMoney_(resolvedUnitCost),
        roundMoney_(quantity * resolvedUnitCost)
      ];
    })
    .sort(function (left, right) { return timeValue_(right[0]) - timeValue_(left[0]); });
}

function buildCashReport_(source) {
  const users = indexBy_(source.users, 'id');
  const inventoryMovements = indexBy_(source.inventoryMovements, 'id');
  const movements = [];

  source.movements.forEach(function (movement) {
    const type = String(movement.movement_type || '');
    if (type !== 'payment' && type !== 'payment_reversal') return;
    const amount = Math.abs(number_(movement.amount));
    const impact = type === 'payment' ? amount : -amount;
    const payer = users[String(movement.paid_by_user_id || movement.user_id)] || {};
    movements.push(cashMovement_(
      movement.created_at,
      type === 'payment' ? 'Cobro' : 'Reverso de cobro',
      String(movement.note || payer.name || ''),
      impact
    ));
  });

  source.inventoryMovements.forEach(function (movement) {
    const type = String(movement.movement_type || '');
    const original = inventoryMovements[String(movement.reversed_movement_id || '')] || {};
    const isPurchase = type === 'purchase';
    const isPurchaseReversal =
      type === 'adjustment_reversal' && String(original.movement_type || '') === 'purchase';
    if (!isPurchase && !isPurchaseReversal) return;
    const unitCost = nullableNumber_(movement.unit_cost);
    const resolvedUnitCost = unitCost === null ? number_(original.unit_cost) : unitCost;
    const impact = -number_(movement.quantity_delta) * resolvedUnitCost;
    movements.push(cashMovement_(
      movement.created_at,
      isPurchase ? 'Compra' : 'Reverso de compra',
      String(movement.note || ''),
      impact
    ));
  });

  source.financeEvents.forEach(function (event) {
    const type = String(event.event_type || '');
    const amount = Math.abs(number_(event.amount));
    const sign = {
      capital_contribution: 1,
      expense: -1,
      owner_withdrawal: -1,
      capital_contribution_reversal: -1,
      expense_reversal: 1,
      owner_withdrawal_reversal: 1
    }[type];
    if (!sign) return;
    movements.push(cashMovement_(
      event.created_at,
      financeLabel_(type),
      String(event.note || event.beneficiary || ''),
      amount * sign
    ));
  });

  movements.sort(function (left, right) { return timeValue_(right[0]) - timeValue_(left[0]); });
  const netByType = function (types) {
    return movements.reduce(function (total, row) {
      return types.includes(String(row[1])) ? total + number_(row[4]) : total;
    }, 0);
  };
  const cashBalance = movements.reduce(function (total, row) { return total + number_(row[4]); }, 0);

  return {
    summary: [
      ['Inversión', roundMoney_(netByType(['Inversión', 'Reverso de inversión']))],
      ['Cobros recibidos', roundMoney_(netByType(['Cobro', 'Reverso de cobro']))],
      ['Compras', roundMoney_(Math.max(0, -netByType(['Compra', 'Reverso de compra'])))],
      ['Gastos', roundMoney_(Math.max(0, -netByType(['Gasto', 'Reverso de gasto'])))],
      ['Retiros', roundMoney_(Math.max(0, -netByType(['Retiro', 'Reverso de retiro'])))],
      ['Caja actual', roundMoney_(cashBalance)]
    ],
    movements: movements.map(function (row) {
      const impact = number_(row[4]);
      return [row[0], row[1], row[2], impact > 0 ? impact : '', impact < 0 ? -impact : ''];
    })
  };
}

function cashMovement_(date, type, concept, impact) {
  return [dateCell_(date), type, concept, impact > 0 ? impact : 0, roundMoney_(impact)];
}

function writeCashSheet_(spreadsheet, cash) {
  const sheet = getReportSheet_(spreadsheet, 'Caja');
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();
  sheet.getRange('A1:B1').merge().setValue('Caja básica').setFontWeight('bold').setFontSize(14);
  sheet.getRange(3, 1, cash.summary.length, 2).setValues(cash.summary);
  sheet.getRange(3, 1, cash.summary.length, 1).setFontWeight('bold');
  sheet.getRange(3, 2, cash.summary.length, 1).setNumberFormat('$#,##0.00');

  const headerRow = 11;
  const headers = ['Fecha', 'Tipo', 'Concepto', 'Entrada', 'Salida'];
  sheet.getRange(headerRow, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sheet.getRange(headerRow, 1, 1, headers.length));
  if (cash.movements.length) {
    sheet.getRange(headerRow + 1, 1, cash.movements.length, headers.length).setValues(cash.movements);
    sheet.getRange(headerRow + 1, 1, cash.movements.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange(headerRow + 1, 4, cash.movements.length, 2).setNumberFormat('$#,##0.00');
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function writeReportTable_(spreadsheet, name, headers, rows) {
  const sheet = getReportSheet_(spreadsheet, name);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  styleHeader_(sheet.getRange(1, 1, 1, headers.length));
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, Math.max(rows.length + 1, 2), headers.length).createFilter();
  sheet.autoResizeColumns(1, headers.length);
  formatReportColumns_(sheet, headers, rows.length);
}

function styleHeader_(range) {
  range.setFontWeight('bold').setBackground('#0b3d2e').setFontColor('#ffffff');
}

function formatReportColumns_(sheet, headers, rowCount) {
  if (!rowCount) return;
  headers.forEach(function (header, index) {
    const range = sheet.getRange(2, index + 1, rowCount, 1);
    if (header === 'Fecha') range.setNumberFormat('dd/mm/yyyy hh:mm');
    if (['Precio', 'Precio unitario', 'Total'].includes(header)) range.setNumberFormat('$#,##0.00');
    if (header === 'Cantidad') range.setNumberFormat('0.###');
  });
}

function getReportSheet_(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name);
  if (sheet) {
    if (sheet.isSheetHidden()) sheet.showSheet();
    return sheet;
  }
  if (name === REPORT_SHEETS[0] && spreadsheet.getSheets().length === 1) {
    const onlySheet = spreadsheet.getSheets()[0];
    if (onlySheet.getLastRow() === 0) {
      onlySheet.setName(name);
      return onlySheet;
    }
  }
  return spreadsheet.insertSheet(name);
}

function readRawTable_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return [];
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const headers = values[0].map(String);
  return values.slice(1).filter(function (row) {
    return row.some(function (value) { return value !== ''; });
  }).map(function (row) {
    return headers.reduce(function (record, header, index) {
      record[header] = row[index];
      return record;
    }, {});
  }).filter(function (record) {
    return String(record._backup_status || 'ACTIVE') !== 'DELETED';
  });
}

function hideRawSheets() {
  const spreadsheet = SpreadsheetApp.openById(getConfig_().spreadsheetId);
  hideSheets_(spreadsheet, RAW_SHEETS);
}

function hideSheets_(spreadsheet, names) {
  names.forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    const visibleSheets = spreadsheet.getSheets().filter(function (item) { return !item.isSheetHidden(); });
    if (sheet && !sheet.isSheetHidden() && visibleSheets.length > 1) sheet.hideSheet();
  });
}

function showRawSheets() {
  const spreadsheet = SpreadsheetApp.openById(getConfig_().spreadsheetId);
  RAW_SHEETS.forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet) sheet.showSheet();
  });
}

function indexBy_(rows, key) {
  return rows.reduce(function (result, row) {
    result[String(row[key] || '')] = row;
    return result;
  }, {});
}

function sumBy_(rows, key, valueKey) {
  return rows.reduce(function (result, row) {
    const id = String(row[key] || '');
    result[id] = number_(result[id]) + number_(row[valueKey]);
    return result;
  }, {});
}

function number_(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney_(value) {
  return Math.round((number_(value) + Number.EPSILON) * 100) / 100;
}

function dateCell_(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date;
}

function timeValue_(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function financeLabel_(type) {
  return {
    capital_contribution: 'Inversión',
    expense: 'Gasto',
    owner_withdrawal: 'Retiro',
    capital_contribution_reversal: 'Reverso de inversión',
    expense_reversal: 'Reverso de gasto',
    owner_withdrawal_reversal: 'Reverso de retiro'
  }[type] || String(type || '');
}
