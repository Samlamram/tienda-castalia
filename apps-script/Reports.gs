const REPORT_TIME_ZONE = 'America/Bogota';
const REPORT_SHEETS = ['Resumen', 'Ventas', 'Cobros', 'Compras_Gastos', 'Finanzas', 'Inventario'];
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
  'store_finance_events',
  'audit_log',
  '_dashboard_data'
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
  const cell = e.range.getA1Notation();
  if (cell === 'H5' && e.value === 'TRUE') refreshDashboard();
}

function refreshDashboard() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(getConfig_().spreadsheetId);
    const source = loadReportSource_(spreadsheet);
    writeSummary_(
      spreadsheet,
      source,
      buildSalesRows_(source),
      buildCollectionRows_(source),
      buildPurchaseRows_(source),
      buildFinanceRows_(source),
      buildInventoryRows_(source)
    );
    hideRawSheets();
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
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
    const finance = buildFinanceRows_(source);
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
    writeReportTable_(spreadsheet, 'Finanzas', [
      'Fecha', 'Mes', 'Movimiento ID', 'Tipo', 'Impacto en caja',
      'Valor original', 'Beneficiario', 'Concepto', 'Registrado por', 'Estado'
    ], finance);
    writeReportTable_(spreadsheet, 'Inventario', [
      'Producto', 'Categoría', 'Estado', 'Stock actual', 'Stock mínimo',
      'Último costo', 'Valor inventario', 'Precio venta', 'Valor venta potencial',
      'Utilidad potencial/unidad', 'Margen potencial', 'Reponer'
    ], inventory);
    writeSummary_(spreadsheet, source, sales, collections, purchases, finance, inventory);
    hideRawSheets();
    SpreadsheetApp.flush();
    return {
      ok: true,
      salesRows: sales.length,
      collectionRows: collections.length,
      purchaseRows: purchases.length,
      financeRows: finance.length,
      inventoryRows: inventory.length,
      dashboardCharts: spreadsheet.getSheetByName('Resumen').getCharts().length
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
    allocations: readRawTable_(spreadsheet, 'fifo_cost_allocations'),
    financeEvents: readRawTable_(spreadsheet, 'store_finance_events')
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

function buildFinanceRows_(source) {
  const users = indexBy_(source.users, 'id');
  return source.financeEvents
    .map(function (event) {
      const type = String(event.event_type || '');
      const isReversal = type.endsWith('_reversal');
      const baseType = type.replace('_reversal', '');
      const amount = number_(event.amount);
      const baseSign = baseType === 'capital_contribution' ? 1 : -1;
      const cashImpact = amount * baseSign * (isReversal ? -1 : 1);
      const creator = users[String(event.created_by)] || {};
      return [
        dateCell_(event.created_at),
        monthKey_(event.created_at),
        String(event.id || ''),
        financeLabel_(type),
        roundMoney_(cashImpact),
        roundMoney_(amount),
        String(event.beneficiary || ''),
        String(event.note || ''),
        String(creator.name || 'Administrador'),
        isReversal ? 'REVERSADO' : 'REGISTRADO'
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

function writeSummary_(spreadsheet, source, sales, collections, purchases, finance, inventory) {
  const sheet = getReportSheet_(spreadsheet, 'Resumen');
  const previousMonth = String(sheet.getRange('B5').getDisplayValue() || '');
  const previousAccount = String(sheet.getRange('D5').getDisplayValue() || 'TODAS');
  const previousUser = String(sheet.getRange('F5').getDisplayValue() || 'TODOS');
  const months = unique_(
    sales.concat(collections, purchases, finance)
      .map(function (row) { return row[1]; })
      .filter(Boolean)
  ).sort().reverse();
  const accountNames = unique_(sales.map(function (row) { return row[3]; }).filter(Boolean)).sort();
  const userNames = unique_(sales.map(function (row) { return row[4]; }).filter(Boolean)).sort();
  const currentMonth = monthKey_(new Date());
  const selectedMonth = months.includes(previousMonth) ? previousMonth : (months[0] || currentMonth);
  const selectedAccount = accountNames.includes(previousAccount) ? previousAccount : 'TODAS';
  const selectedUser = userNames.includes(previousUser) ? previousUser : 'TODOS';
  const commercialFilterActive = selectedAccount !== 'TODAS' || selectedUser !== 'TODOS';
  const periodSales = sales.filter(function (row) {
    return row[1] === selectedMonth && row[15] === 'CONFIRMADO' &&
      (selectedAccount === 'TODAS' || row[3] === selectedAccount) &&
      (selectedUser === 'TODOS' || row[4] === selectedUser);
  });
  const periodCollections = collections.filter(function (row) {
    return row[1] === selectedMonth &&
      (selectedAccount === 'TODAS' || row[4] === selectedAccount) &&
      (selectedUser === 'TODOS' || row[5] === selectedUser);
  });
  const periodPurchases = purchases.filter(function (row) { return row[1] === selectedMonth && row[5] === 'COMPRA'; });
  const periodFinance = finance.filter(function (row) { return row[1] === selectedMonth; });

  const netSales = sumColumn_(periodSales, 9);
  const fifoCost = sumColumn_(periodSales, 10);
  const grossProfit = netSales - fifoCost;
  const storeCollections = source.movements
    .filter(function (movement) {
      return monthKey_(movement.created_at) === selectedMonth &&
        ['payment', 'payment_reversal'].includes(String(movement.movement_type));
    })
    .reduce(function (total, movement) { return total + number_(movement.amount); }, 0);
  const collected = commercialFilterActive ? sumColumn_(periodCollections, 7) : storeCollections;
  const pending = sumColumn_(periodSales, 14);
  const inventoryPurchases = sumColumn_(periodPurchases, 8);
  const contributions = sumFinanceRows_(periodFinance, 'INVERSIÓN');
  const expenses = -sumFinanceRows_(periodFinance, 'GASTO');
  const withdrawals = -sumFinanceRows_(periodFinance, 'RETIRO');
  const reportedProfit = commercialFilterActive ? grossProfit : grossProfit - expenses;
  const reportedMargin = netSales > 0 ? reportedProfit / netSales : 0;
  const netCashFlow = storeCollections + contributions - inventoryPurchases - expenses - withdrawals;
  const inventoryValue = sumColumn_(inventory, 6);
  const allContributions = sumFinanceRows_(finance, 'INVERSIÓN');
  const allExpenses = -sumFinanceRows_(finance, 'GASTO');
  const allWithdrawals = -sumFinanceRows_(finance, 'RETIRO');
  const allCollections = source.movements
    .filter(function (movement) {
      return ['payment', 'payment_reversal'].includes(String(movement.movement_type));
    })
    .reduce(function (total, movement) { return total + number_(movement.amount); }, 0);
  const allPurchases = calculatePurchaseCash_(source.inventoryMovements);
  const cashAvailable = allCollections + allContributions - allPurchases - allExpenses - allWithdrawals;
  const totalReceivable = sumColumn_(sales.filter(function (row) { return row[15] === 'CONFIRMADO'; }), 14);
  const storeValue = cashAvailable + inventoryValue + totalReceivable;

  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.getCharts().forEach(function (chart) { sheet.removeChart(chart); });
  sheet.clear();
  sheet.setConditionalFormatRules([]);
  sheet.setHiddenGridlines(true);
  sheet.getRange('A1:L1').merge().setValue('Dashboard financiero · App Tienda');
  sheet.getRange('A2:L2').merge().setValue(
    'Rentabilidad comercial, caja, inventario y alertas en una sola vista'
  );
  sheet.getRange('A3:L3').merge().setValue(
    'CÓMO ACTUALIZAR: 1. Elige periodo, cuenta o usuario · 2. Marca la casilla amarilla “Actualizar” · 3. Espera a que termine'
  );
  sheet.getRange('A4:F4').merge().setValue('Filtros comerciales');
  sheet.getRange('G4:L4').merge().setValue('Actualización del dashboard');
  sheet.getRange('A5').setValue('Periodo');
  sheet.getRange('B5').setValue(selectedMonth);
  if (months.length) {
    sheet.getRange('B5').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(months, true).build()
    );
  }
  sheet.getRange('C5').setValue('Cuenta');
  sheet.getRange('D5').setValue(selectedAccount).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['TODAS'].concat(accountNames), true).build()
  );
  sheet.getRange('E5').setValue('Usuario');
  sheet.getRange('F5').setValue(selectedUser).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['TODOS'].concat(userNames), true).build()
  );
  sheet.getRange('G5').setValue('Actualizar →').setFontWeight('bold');
  sheet.getRange('H5').insertCheckboxes().setValue(false).setBackground('#fce8b2');
  sheet.getRange('I5:J5').merge().setValue('Última actualización');
  sheet.getRange('K5:L5').merge().setValue(new Date()).setNumberFormat('dd/mm/yyyy hh:mm');

  writeKpiCard_(sheet, 7, 1, 'Ventas netas', netSales, '#1a73e8', '$#,##0');
  writeKpiCard_(sheet, 7, 3, commercialFilterActive ? 'Utilidad bruta filtrada' : 'Utilidad neta', reportedProfit, '#188038', '$#,##0');
  writeKpiCard_(sheet, 7, 5, commercialFilterActive ? 'Margen bruto filtrado' : 'Margen neto', reportedMargin, '#188038', '0.0%');
  writeKpiCard_(sheet, 7, 7, 'Cobros aplicados', collected, '#1a73e8', '$#,##0');
  writeKpiCard_(sheet, 7, 9, 'Por cobrar', pending, '#f9ab00', '$#,##0');
  writeKpiCard_(sheet, 7, 11, 'Caja estimada', cashAvailable, cashAvailable >= 0 ? '#188038' : '#d93025', '$#,##0');

  writeKpiCard_(sheet, 12, 1, 'Costo FIFO', fifoCost, '#5f6368', '$#,##0');
  writeKpiCard_(sheet, 12, 3, 'Gastos del mes', expenses, '#d93025', '$#,##0');
  writeKpiCard_(sheet, 12, 5, 'Compras de inventario', inventoryPurchases, '#5f6368', '$#,##0');
  writeKpiCard_(sheet, 12, 7, 'Inventario al costo', inventoryValue, '#1a73e8', '$#,##0');
  writeKpiCard_(sheet, 12, 9, 'Flujo neto del mes', netCashFlow, netCashFlow >= 0 ? '#188038' : '#d93025', '$#,##0');
  writeKpiCard_(sheet, 12, 11, 'Valor estimado tienda', storeValue, storeValue >= 0 ? '#188038' : '#d93025', '$#,##0');
  sheet.getRange('A16:L16').merge().setValue(
    commercialFilterActive
      ? 'Los indicadores de ventas respetan los filtros. Caja, gastos e inventario muestran el total de la tienda.'
      : 'Vista completa de la tienda. Inversión y retiros afectan caja, pero no cambian la utilidad generada.'
  ).setFontColor('#5f6368').setFontStyle('italic');

  const trendMonths = months.slice().reverse().slice(-12);
  const trendRows = trendMonths.map(function (month) {
    const monthSales = sales.filter(function (row) {
      return row[1] === month && row[15] === 'CONFIRMADO' &&
        (selectedAccount === 'TODAS' || row[3] === selectedAccount) &&
        (selectedUser === 'TODOS' || row[4] === selectedUser);
    });
    return [month, roundMoney_(sumColumn_(monthSales, 9)), roundMoney_(sumColumn_(monthSales, 11))];
  });
  if (!trendRows.length) trendRows.push([selectedMonth, 0, 0]);
  const productProfit = aggregateRanking_(periodSales, 5, 11);
  const dashboardData = writeDashboardData_(spreadsheet, trendRows, [
    ['Cobros', roundMoney_(storeCollections)],
    ['Inversión', roundMoney_(contributions)],
    ['Compras', roundMoney_(-inventoryPurchases)],
    ['Gastos', roundMoney_(-expenses)],
    ['Retiros', roundMoney_(-withdrawals)]
  ], productProfit);
  createDashboardCharts_(sheet, dashboardData);

  const productRanking = aggregateBusinessRanking_(periodSales, 5)
    .slice(0, 10)
    .map(function (row) { return [row[0], row[1], row[2], row[1] > 0 ? row[2] / row[1] : 0]; });
  const accountRanking = aggregateBusinessRanking_(periodSales, 3)
    .slice(0, 10)
    .map(function (row) { return [row[0], row[1], row[3], row[2]]; });
  const userRanking = aggregateBusinessRanking_(periodSales, 4)
    .slice(0, 10)
    .map(function (row) { return [row[0], row[1], row[2], row[1] > 0 ? row[2] / row[1] : 0]; });
  writeDashboardTable_(sheet, 36, 1, 'Top productos', ['Producto', 'Ventas', 'Utilidad', 'Margen'], productRanking, 4);
  writeDashboardTable_(sheet, 36, 5, 'Top cuentas', ['Cuenta', 'Ventas', 'Por cobrar', 'Utilidad'], accountRanking, 4);
  writeDashboardTable_(sheet, 36, 9, 'Top usuarios', ['Usuario', 'Ventas', 'Utilidad', 'Margen'], userRanking, 4);

  const lowStock = inventory
    .filter(function (row) { return row[11] === 'SÍ' && row[2] === 'ACTIVO'; })
    .sort(function (left, right) { return number_(left[3]) - number_(right[3]); })
    .slice(0, 10)
    .map(function (row) { return [row[0], row[3], row[4], row[11]]; });
  const accountDebt = aggregateRanking_(periodSales, 3, 14).filter(function (row) { return row[1] > 0; });
  const recentFinance = finance
    .filter(function (row) { return row[1] === selectedMonth; })
    .slice(0, 10)
    .map(function (row) { return [row[0], row[3], row[7], row[4]]; });
  writeDashboardTable_(sheet, 51, 1, 'Alertas de inventario', ['Producto', 'Stock', 'Mínimo', 'Alerta'], lowStock, 4);
  writeDashboardTable_(sheet, 51, 5, 'Cuentas con saldo pendiente', ['Cuenta', 'Saldo'], accountDebt.slice(0, 10), 4);
  writeDashboardTable_(sheet, 51, 9, 'Movimientos financieros recientes', ['Fecha', 'Tipo', 'Concepto', 'Caja'], recentFinance, 4);

  sheet.getRange('A1:L1').setFontWeight('bold').setFontSize(18).setFontColor('#202124').setHorizontalAlignment('left');
  sheet.getRange('A2:L2').setFontColor('#5f6368').setFontSize(10);
  sheet.getRange('A3:L3').setFontWeight('bold').setBackground('#e8f0fe').setFontColor('#174ea6');
  sheet.getRange('A4:F4').setFontWeight('bold').setBackground('#f1f3f4');
  sheet.getRange('G4:L4').setFontWeight('bold').setBackground('#f1f3f4');
  sheet.getRange('A5:L5').setVerticalAlignment('middle');
  ['A5', 'C5', 'E5', 'G5', 'I5'].forEach(function (cell) { sheet.getRange(cell).setFontWeight('bold'); });
  sheet.setFrozenRows(5);
  sheet.setColumnWidths(1, 12, 95);
  sheet.setRowHeight(1, 32);
  sheet.setRowHeight(2, 22);
  sheet.setRowHeight(3, 32);
  sheet.setRowHeight(5, 32);
  sheet.setTabColor('#1a73e8');
  sheet.activate();
}

function writeKpiCard_(sheet, row, column, title, value, accent, numberFormat) {
  const titleRange = sheet.getRange(row, column, 1, 2).merge();
  const valueRange = sheet.getRange(row + 1, column, 2, 2).merge();
  const fullRange = sheet.getRange(row, column, 3, 2);
  titleRange.setValue(title).setFontSize(9).setFontWeight('bold').setFontColor('#5f6368');
  valueRange.setValue(roundMoney_(value)).setNumberFormat(numberFormat)
    .setFontSize(17).setFontWeight('bold').setFontColor(accent).setVerticalAlignment('middle');
  fullRange.setBackground('#ffffff').setBorder(true, true, true, true, false, false, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);
}

function writeDashboardData_(spreadsheet, trendRows, cashRows, productProfit) {
  const sheet = spreadsheet.getSheetByName('_dashboard_data') || spreadsheet.insertSheet('_dashboard_data');
  sheet.clear();
  sheet.getRange(1, 1, 1, 3).setValues([['Mes', 'Ventas', 'Utilidad bruta']]);
  sheet.getRange(2, 1, trendRows.length, 3).setValues(trendRows);
  sheet.getRange(1, 5, 1, 2).setValues([['Concepto', 'Valor']]);
  sheet.getRange(2, 5, cashRows.length, 2).setValues(cashRows);
  const productRows = productProfit.length ? productProfit.slice(0, 8) : [['Sin ventas', 0]];
  sheet.getRange(1, 8, 1, 2).setValues([['Producto', 'Utilidad']]);
  sheet.getRange(2, 8, productRows.length, 2).setValues(productRows);
  return {
    sheet: sheet,
    trendCount: trendRows.length,
    cashCount: cashRows.length,
    productCount: productRows.length
  };
}

function createDashboardCharts_(sheet, data) {
  const trendChart = sheet.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(data.sheet.getRange(1, 1, data.trendCount + 1, 3))
    .setNumHeaders(1)
    .setPosition(17, 1, 0, 0)
    .setOption('title', 'Ventas y utilidad bruta por mes')
    .setOption('legend', { position: 'bottom' })
    .setOption('colors', ['#1a73e8', '#188038'])
    .setOption('backgroundColor', '#ffffff')
    .setOption('width', 555)
    .setOption('height', 300)
    .build();
  sheet.insertChart(trendChart);

  const cashChart = sheet.newChart()
    .setChartType(Charts.ChartType.WATERFALL)
    .addRange(data.sheet.getRange(1, 5, data.cashCount + 1, 2))
    .setNumHeaders(1)
    .setPosition(17, 7, 0, 0)
    .setOption('title', 'Waterfall · cómo se forma el flujo neto del mes')
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#1a73e8'])
    .setOption('backgroundColor', '#ffffff')
    .setOption('width', 555)
    .setOption('height', 300)
    .build();
  sheet.insertChart(cashChart);
}

function writeDashboardTable_(sheet, row, column, title, headers, rows, width) {
  sheet.getRange(row, column, 1, width).merge().setValue(title)
    .setFontWeight('bold').setFontColor('#202124').setBackground('#f1f3f4');
  const paddedHeaders = headers.concat(Array(Math.max(0, width - headers.length)).fill(''));
  sheet.getRange(row + 1, column, 1, width).setValues([paddedHeaders.slice(0, width)])
    .setFontWeight('bold').setFontColor('#5f6368').setBackground('#fafafa');
  const safeRows = rows.length ? rows : [['Sin alertas']];
  const paddedRows = safeRows.map(function (dataRow) {
    return dataRow.concat(Array(Math.max(0, width - dataRow.length)).fill('')).slice(0, width);
  });
  sheet.getRange(row + 2, column, paddedRows.length, width).setValues(paddedRows);
  sheet.getRange(row, column, paddedRows.length + 2, width)
    .setBorder(true, true, true, true, false, true, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);
  if (title === 'Cuentas con saldo pendiente' && paddedRows.length) {
    sheet.getRange(row + 2, column + 1, paddedRows.length, 1).setNumberFormat('$#,##0');
  }
  if (title === 'Movimientos financieros recientes' && paddedRows.length) {
    sheet.getRange(row + 2, column, paddedRows.length, 1).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(row + 2, column + 3, paddedRows.length, 1).setNumberFormat('$#,##0');
  }
  if (title === 'Top productos' || title === 'Top usuarios') {
    sheet.getRange(row + 2, column + 1, paddedRows.length, 2).setNumberFormat('$#,##0');
    sheet.getRange(row + 2, column + 3, paddedRows.length, 1).setNumberFormat('0.0%');
  }
  if (title === 'Top cuentas') {
    sheet.getRange(row + 2, column + 1, paddedRows.length, 3).setNumberFormat('$#,##0');
  }
}

function calculatePurchaseCash_(movements) {
  const byId = indexBy_(movements, 'id');
  return movements.reduce(function (total, movement) {
    const type = String(movement.movement_type || '');
    if (type === 'purchase') {
      return total + number_(movement.quantity_delta) * number_(movement.unit_cost);
    }
    const original = byId[String(movement.reversed_movement_id || '')] || {};
    if (type === 'adjustment_reversal' && original.movement_type === 'purchase') {
      return total + number_(movement.quantity_delta) * number_(original.unit_cost);
    }
    return total;
  }, 0);
}

function sumFinanceRows_(rows, baseLabel) {
  return rows.reduce(function (total, row) {
    const label = String(row[3] || '');
    return label === baseLabel || label === 'REVERSO DE ' + baseLabel
      ? total + number_(row[4]) * (baseLabel === 'INVERSIÓN' ? 1 : -1)
      : total;
  }, 0);
}

function aggregateBusinessRanking_(rows, nameIndex) {
  const totals = {};
  rows.forEach(function (row) {
    const name = String(row[nameIndex] || 'Sin dato');
    if (!totals[name]) totals[name] = { sales: 0, profit: 0, pending: 0 };
    totals[name].sales += number_(row[9]);
    totals[name].profit += number_(row[11]);
    totals[name].pending += number_(row[14]);
  });
  return Object.keys(totals)
    .map(function (name) {
      return [
        name,
        roundMoney_(totals[name].sales),
        roundMoney_(totals[name].profit),
        roundMoney_(totals[name].pending)
      ];
    })
    .sort(function (left, right) { return right[1] - left[1]; });
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
      'Precio venta', 'Valor venta potencial', 'Utilidad potencial/unidad', 'Impacto en caja',
      'Valor original'].includes(header)) {
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

function financeLabel_(type) {
  return {
    capital_contribution: 'INVERSIÓN',
    expense: 'GASTO',
    owner_withdrawal: 'RETIRO',
    capital_contribution_reversal: 'REVERSO DE INVERSIÓN',
    expense_reversal: 'REVERSO DE GASTO',
    owner_withdrawal_reversal: 'REVERSO DE RETIRO'
  }[type] || String(type || '').toUpperCase();
}
