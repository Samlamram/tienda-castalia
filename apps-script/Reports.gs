const REPORT_TIME_ZONE = 'America/Bogota';
const REPORT_SHEETS = ['Resumen', 'Ventas', 'Cobros', 'Compras_Gastos', 'Inventario'];
const RAW_SHEETS = [
  EVENT_SHEET,
  'accounts',
  'app_users',
  'app_sessions',
  'products',
  'consumptions',
  'consumption_items',
  'financial_movements',
  'payment_applications',
  'inventory_movements',
  'fifo_cost_allocations',
  'audit_log'
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tienda')
    .addItem('Actualizar reporte', 'refreshReports')
    .addItem('Mostrar datos técnicos', 'showRawSheets')
    .addItem('Ocultar datos técnicos', 'hideRawSheets')
    .addToUi();
}

function onEdit(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== 'Resumen') return;
  if (e.range.getA1Notation() !== 'B4' || e.value !== 'TRUE') return;
  refreshReports();
}

function refreshReports() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(getConfig_().spreadsheetId);
    const source = loadReportSource_(spreadsheet);
    const sales = buildSalesRows_(source);
    const collections = buildCollectionRows_(source);
    const purchases = buildPurchaseRows_(source);
    const inventory = buildInventoryRows_(source);

    writeReportTable_(spreadsheet, 'Ventas', [
      'Fecha', 'Mes', 'Consumo ID', 'Cuenta', 'Usuario', 'Producto', 'Categoría',
      'Cantidad', 'Precio unitario', 'Venta neta', 'Costo FIFO', 'Utilidad bruta',
      'Margen', 'Cobrado asignado', 'Saldo pendiente', 'Estado'
    ], sales);
    writeReportTable_(spreadsheet, 'Cobros', [
      'Fecha', 'Mes', 'Movimiento ID', 'Consumo ID', 'Cuenta', 'Usuario',
      'Tipo', 'Monto', 'Nota', 'Estado'
    ], collections);
    writeReportTable_(spreadsheet, 'Compras_Gastos', [
      'Fecha', 'Mes', 'Movimiento ID', 'Producto', 'Categoría', 'Tipo',
      'Cantidad', 'Costo unitario', 'Valor', 'Nota'
    ], purchases);
    writeReportTable_(spreadsheet, 'Inventario', [
      'Producto', 'Categoría', 'Estado', 'Stock actual', 'Stock mínimo',
      'Último costo', 'Valor inventario', 'Precio venta', 'Valor venta potencial',
      'Utilidad potencial/unidad', 'Margen potencial', 'Reponer'
    ], inventory);
    writeSummary_(spreadsheet, sales, collections, purchases, inventory);
    hideRawSheets();
    SpreadsheetApp.flush();
    return {
      ok: true,
      salesRows: sales.length,
      collectionRows: collections.length,
      purchaseRows: purchases.length,
      inventoryRows: inventory.length
    };
  } finally {
    lock.releaseLock();
  }
}

function loadReportSource_(spreadsheet) {
  return {
    accounts: readRawTable_(spreadsheet, 'accounts'),
    users: readRawTable_(spreadsheet, 'app_users'),
    products: readRawTable_(spreadsheet, 'products'),
    consumptions: readRawTable_(spreadsheet, 'consumptions'),
    items: readRawTable_(spreadsheet, 'consumption_items'),
    movements: readRawTable_(spreadsheet, 'financial_movements'),
    applications: readRawTable_(spreadsheet, 'payment_applications'),
    inventoryMovements: readRawTable_(spreadsheet, 'inventory_movements'),
    allocations: readRawTable_(spreadsheet, 'fifo_cost_allocations')
  };
}

function buildSalesRows_(source) {
  const accounts = indexBy_(source.accounts, 'id');
  const users = indexBy_(source.users, 'id');
  const products = indexBy_(source.products, 'id');
  const consumptions = indexBy_(source.consumptions, 'id');
  const costsByItem = sumBy_(source.allocations, 'consumption_item_id', 'cost_total');
  const paidByConsumption = sumBy_(source.applications, 'consumption_id', 'amount');

  return source.items
    .map(function (item) {
      const consumption = consumptions[String(item.consumption_id)] || {};
      const user = users[String(item.user_id || consumption.user_id)] || {};
      const account = accounts[String(item.account_id || consumption.account_id || user.account_id)] || {};
      const product = products[String(item.product_id)] || {};
      const status = String(consumption.status || 'confirmed');
      const quantity = number_(item.quantity);
      const unitPrice = number_(item.unit_price);
      const grossSale = number_(item.total) || quantity * unitPrice;
      const netSale = status === 'voided' ? 0 : grossSale;
      const fifoCost = status === 'voided' ? 0 : number_(costsByItem[String(item.id)]);
      const profit = netSale - fifoCost;
      const consumptionTotal = number_(consumption.total);
      const paidTotal = Math.max(0, number_(paidByConsumption[String(consumption.id)]));
      const paidShare = status === 'voided' || consumptionTotal <= 0
        ? 0
        : Math.min(netSale, paidTotal * grossSale / consumptionTotal);
      return [
        dateCell_(item.created_at || consumption.created_at),
        monthKey_(item.created_at || consumption.created_at),
        String(item.consumption_id || ''),
        String(account.name || 'Sin cuenta'),
        String(user.name || 'Sin usuario'),
        String(item.product_name || product.name || 'Sin producto'),
        String(product.category || 'Sin categoría'),
        quantity,
        unitPrice,
        roundMoney_(netSale),
        roundMoney_(fifoCost),
        roundMoney_(profit),
        netSale > 0 ? profit / netSale : 0,
        roundMoney_(paidShare),
        roundMoney_(Math.max(0, netSale - paidShare)),
        status === 'voided' ? 'ANULADO' : 'CONFIRMADO'
      ];
    })
    .sort(function (left, right) { return String(right[0]).localeCompare(String(left[0])); });
}

function buildCollectionRows_(source) {
  const accounts = indexBy_(source.accounts, 'id');
  const users = indexBy_(source.users, 'id');
  const movements = indexBy_(source.movements, 'id');
  return source.applications
    .map(function (application) {
      const movement = movements[String(application.financial_movement_id)] || {};
      const user = users[String(application.user_id || movement.user_id || movement.paid_by_user_id)] || {};
      const account = accounts[String(application.account_id || movement.account_id || user.account_id)] || {};
      const type = String(movement.movement_type || 'payment');
      return [
        dateCell_(application.created_at || movement.created_at),
        monthKey_(application.created_at || movement.created_at),
        String(application.financial_movement_id || ''),
        String(application.consumption_id || ''),
        String(account.name || 'Sin cuenta'),
        String(user.name || 'Sin usuario'),
        movementLabel_(type),
        roundMoney_(number_(application.amount)),
        String(movement.note || ''),
        number_(application.amount) < 0 ? 'REVERSADO' : 'APLICADO'
      ];
    })
    .sort(function (left, right) { return String(right[0]).localeCompare(String(left[0])); });
}

function buildPurchaseRows_(source) {
  const products = indexBy_(source.products, 'id');
  return source.inventoryMovements
    .filter(function (movement) {
      return ['purchase', 'adjustment', 'adjustment_reversal'].includes(String(movement.movement_type));
    })
    .map(function (movement) {
      const product = products[String(movement.product_id)] || {};
      const quantity = number_(movement.quantity_delta);
      const unitCost = nullableNumber_(movement.unit_cost);
      return [
        dateCell_(movement.created_at),
        monthKey_(movement.created_at),
        String(movement.id || ''),
        String(product.name || 'Sin producto'),
        String(product.category || 'Sin categoría'),
        inventoryLabel_(String(movement.movement_type)),
        quantity,
        unitCost === null ? '' : unitCost,
        unitCost === null ? '' : roundMoney_(quantity * unitCost),
        String(movement.note || '')
      ];
    })
    .sort(function (left, right) { return String(right[0]).localeCompare(String(left[0])); });
}

function buildInventoryRows_(source) {
  const stockByProduct = sumBy_(source.inventoryMovements, 'product_id', 'quantity_delta');
  const allocatedBySource = sumBy_(source.allocations, 'source_movement_id', 'quantity');
  const valueByProduct = {};
  const lastCostByProduct = {};
  const sortedMovements = source.inventoryMovements.slice().sort(function (left, right) {
    return String(left.created_at || '').localeCompare(String(right.created_at || ''));
  });

  sortedMovements.forEach(function (movement) {
    const productId = String(movement.product_id || '');
    const quantity = number_(movement.quantity_delta);
    const unitCost = nullableNumber_(movement.unit_cost);
    if (quantity > 0 && unitCost !== null) {
      const remaining = Math.max(0, quantity - number_(allocatedBySource[String(movement.id)]));
      valueByProduct[productId] = number_(valueByProduct[productId]) + remaining * unitCost;
      lastCostByProduct[productId] = unitCost;
    }
  });

  return source.products
    .map(function (product) {
      const productId = String(product.id || '');
      const stock = number_(stockByProduct[productId]);
      const stockMin = number_(product.stock_min);
      const lastCost = number_(lastCostByProduct[productId]);
      const price = number_(product.price);
      const unitProfit = price - lastCost;
      return [
        String(product.name || 'Sin producto'),
        String(product.category || 'Sin categoría'),
        String(product.status || 'active') === 'active' ? 'ACTIVO' : 'INACTIVO',
        stock,
        stockMin,
        roundMoney_(lastCost),
        roundMoney_(number_(valueByProduct[productId])),
        roundMoney_(price),
        roundMoney_(stock * price),
        roundMoney_(unitProfit),
        price > 0 ? unitProfit / price : 0,
        stock <= stockMin ? 'SÍ' : 'NO'
      ];
    })
    .sort(function (left, right) { return String(left[0]).localeCompare(String(right[0])); });
}

function writeSummary_(spreadsheet, sales, collections, purchases, inventory) {
  const sheet = getReportSheet_(spreadsheet, 'Resumen');
  const previousMonth = String(sheet.getRange('B2').getDisplayValue() || '');
  const months = unique_(sales.map(function (row) { return row[1]; }).filter(Boolean)).sort().reverse();
  const currentMonth = monthKey_(new Date());
  const selectedMonth = months.includes(previousMonth) ? previousMonth : (months[0] || currentMonth);
  const periodSales = sales.filter(function (row) { return row[1] === selectedMonth && row[15] === 'CONFIRMADO'; });
  const periodCollections = collections.filter(function (row) { return row[1] === selectedMonth; });
  const periodPurchases = purchases.filter(function (row) { return row[1] === selectedMonth && row[5] === 'COMPRA'; });

  const netSales = sumColumn_(periodSales, 9);
  const fifoCost = sumColumn_(periodSales, 10);
  const grossProfit = netSales - fifoCost;
  const collected = sumColumn_(periodCollections, 7);
  const pending = sumColumn_(periodSales, 14);
  const inventoryPurchases = sumColumn_(periodPurchases, 8);
  const inventoryValue = sumColumn_(inventory, 6);

  sheet.getRange('A1:H1').breakApart();
  sheet.clear();
  sheet.getRange('A1:H1').merge().setValue('Resumen financiero · App Tienda');
  sheet.getRange('A2').setValue('Periodo (AAAA-MM)');
  sheet.getRange('B2').setValue(selectedMonth);
  if (months.length) {
    sheet.getRange('B2').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(months, true).build()
    );
  }
  sheet.getRange('A3').setValue('Última actualización');
  sheet.getRange('B3').setValue(new Date()).setNumberFormat('dd/mm/yyyy hh:mm');
  sheet.getRange('A4').setValue('Actualizar reporte');
  sheet.getRange('B4').insertCheckboxes().setValue(false);

  const metrics = [
    ['Indicador', 'Valor'],
    ['Ventas netas', roundMoney_(netSales)],
    ['Costo de productos vendidos', roundMoney_(fifoCost)],
    ['Utilidad bruta', roundMoney_(grossProfit)],
    ['Margen bruto', netSales > 0 ? grossProfit / netSales : 0],
    ['Cobros aplicados', roundMoney_(collected)],
    ['Saldo pendiente', roundMoney_(pending)],
    ['Compras de inventario', roundMoney_(inventoryPurchases)],
    ['Valor actual del inventario', roundMoney_(inventoryValue)],
    ['Gastos operativos', 'Pendiente de registrar en Supabase'],
    ['Utilidad neta', 'Disponible cuando se registren gastos']
  ];
  sheet.getRange(6, 1, metrics.length, 2).setValues(metrics);
  sheet.getRange('B7:B14').setNumberFormat('$#,##0');
  sheet.getRange('B10').setNumberFormat('0.0%');

  writeRanking_(sheet, 6, 4, 'Productos con mayor utilidad', aggregateRanking_(periodSales, 5, 11));
  writeRanking_(sheet, 6, 7, 'Usuarios con mayor consumo', aggregateRanking_(periodSales, 4, 9));
  writeRanking_(sheet, 20, 4, 'Cuentas con mayor consumo', aggregateRanking_(periodSales, 3, 9));
  writeRanking_(sheet, 20, 7, 'Productos más vendidos', aggregateRanking_(periodSales, 5, 7));

  sheet.getRange('A1:H1').setFontWeight('bold').setFontSize(16).setHorizontalAlignment('center');
  sheet.getRange('A6:B6').setFontWeight('bold').setBackground('#eeeeee');
  sheet.getRange('A2:A4').setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 180);
  for (let column = 4; column <= 9; column += 1) sheet.setColumnWidth(column, 170);
  sheet.activate();
}

function writeRanking_(sheet, row, column, title, values) {
  const rows = [[title, 'Valor']].concat(values.slice(0, 10));
  sheet.getRange(row, column, rows.length, 2).setValues(rows);
  sheet.getRange(row, column, 1, 2).setFontWeight('bold').setBackground('#eeeeee');
  if (rows.length > 1) sheet.getRange(row + 1, column + 1, rows.length - 1, 1).setNumberFormat('$#,##0.00');
}

function aggregateRanking_(rows, nameIndex, valueIndex) {
  const totals = {};
  rows.forEach(function (row) {
    const name = String(row[nameIndex] || 'Sin dato');
    totals[name] = number_(totals[name]) + number_(row[valueIndex]);
  });
  return Object.keys(totals)
    .map(function (name) { return [name, roundMoney_(totals[name])]; })
    .sort(function (left, right) { return right[1] - left[1]; });
}

function writeReportTable_(spreadsheet, name, headers, rows) {
  const sheet = getReportSheet_(spreadsheet, name);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#eeeeee');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, Math.max(rows.length + 1, 2), headers.length).createFilter();
  sheet.autoResizeColumns(1, headers.length);
  formatReportColumns_(sheet, headers, rows.length);
}

function formatReportColumns_(sheet, headers, rowCount) {
  if (!rowCount) return;
  headers.forEach(function (header, index) {
    const range = sheet.getRange(2, index + 1, rowCount, 1);
    if (header === 'Fecha') range.setNumberFormat('dd/mm/yyyy hh:mm');
    if (['Precio unitario', 'Venta neta', 'Costo FIFO', 'Utilidad bruta', 'Cobrado asignado',
      'Saldo pendiente', 'Monto', 'Costo unitario', 'Valor', 'Último costo', 'Valor inventario',
      'Precio venta', 'Valor venta potencial', 'Utilidad potencial/unidad'].includes(header)) {
      range.setNumberFormat('$#,##0.00');
    }
    if (['Margen', 'Margen potencial'].includes(header)) range.setNumberFormat('0.0%');
    if (['Cantidad', 'Stock actual', 'Stock mínimo'].includes(header)) range.setNumberFormat('0.000');
  });
}

function getReportSheet_(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name);
  if (sheet) return sheet;
  if (name === 'Resumen' && spreadsheet.getSheets().length === 1) {
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
  });
}

function hideRawSheets() {
  const spreadsheet = SpreadsheetApp.openById(getConfig_().spreadsheetId);
  RAW_SHEETS.forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet && !sheet.isSheetHidden() && spreadsheet.getSheets().filter(function (item) { return !item.isSheetHidden(); }).length > 1) {
      sheet.hideSheet();
    }
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

function sumColumn_(rows, index) {
  return rows.reduce(function (total, row) { return total + number_(row[index]); }, 0);
}

function unique_(values) {
  return Array.from(new Set(values));
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

function monthKey_(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, REPORT_TIME_ZONE, 'yyyy-MM');
}

function dateCell_(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date;
}

function movementLabel_(type) {
  return {
    payment: 'PAGO',
    payment_reversal: 'REVERSO DE PAGO',
    adjustment: 'AJUSTE',
    adjustment_reversal: 'REVERSO DE AJUSTE',
    account_transfer: 'TRANSFERENCIA'
  }[type] || String(type || '').toUpperCase();
}

function inventoryLabel_(type) {
  return {
    purchase: 'COMPRA',
    adjustment: 'AJUSTE DE INVENTARIO',
    adjustment_reversal: 'REVERSO DE AJUSTE'
  }[type] || String(type || '').toUpperCase();
}
