import { db } from '../data/db';
import { calculateAccountBalance, calculateProductStocks } from '../domain/ledger';
import type { AccountBalance } from '../domain/types';
import { createId, nowIso } from '../utils/id';

type ExportRows = Record<string, Array<Record<string, string | number | boolean | null>>>;

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function hashPayload(value: unknown): string {
  const raw = JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(index);
    hash |= 0;
  }
  return `${raw.length}_${hash}`;
}

export async function buildExportRows(dateFrom: string, dateTo: string): Promise<ExportRows> {
  const [accounts, users, products, consumptions, items, payments, applications, purchases, movements, adjustments] =
    await Promise.all([
      db.accounts.toArray(),
      db.users.toArray(),
      db.products.toArray(),
      db.consumptions.toArray(),
      db.consumptionItems.toArray(),
      db.payments.toArray(),
      db.paymentApplications.toArray(),
      db.purchases.toArray(),
      db.inventoryMovements.toArray(),
      db.adjustments.toArray()
    ]);
  const balances: AccountBalance[] = accounts.map((account) =>
    calculateAccountBalance({
      account,
      users,
      consumptions,
      items,
      payments,
      applications,
      adjustments
    })
  );
  const stocks = calculateProductStocks(products, movements);
  const userName = (id: string) => users.find((user) => user.id === id)?.name ?? id;
  const accountName = (id?: string) => (id ? accounts.find((account) => account.id === id)?.name ?? id : 'Sin cuenta');
  const productName = (id: string) => products.find((product) => product.id === id)?.name ?? id;

  return {
    Resumen: balances.map((balance) => ({
      cuenta: accountName(balance.accountId),
      consumido: balance.consumed,
      pagado: balance.paid,
      ajustes: balance.adjustments,
      saldo: balance.balance,
      credito_sin_aplicar: balance.unappliedCredit
    })),
    Movimientos: [
      ...consumptions.filter((entry) => inRange(entry.createdAt, dateFrom, dateTo)).map((entry) => ({
        fecha: entry.createdAt,
        tipo: 'consumo',
        cuenta: accountName(entry.accountId),
        usuario: userName(entry.userId),
        valor: entry.total,
        estado: entry.status,
        referencia: entry.id
      })),
      ...payments.filter((entry) => inRange(entry.createdAt, dateFrom, dateTo)).map((entry) => ({
        fecha: entry.createdAt,
        tipo: 'pago',
        cuenta: accountName(entry.accountId),
        usuario: entry.userId ? userName(entry.userId) : '',
        valor: -entry.amount,
        estado: entry.unappliedAmount > 0 ? 'con_credito' : 'aplicado',
        referencia: entry.id
      })),
      ...adjustments.filter((entry) => inRange(entry.createdAt, dateFrom, dateTo)).map((entry) => ({
        fecha: entry.createdAt,
        tipo: 'ajuste',
        cuenta: accountName(entry.accountId),
        usuario: entry.userId ? userName(entry.userId) : '',
        valor: entry.amount,
        estado: entry.scope,
        referencia: entry.id
      }))
    ].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
    Consumos: items.filter((entry) => inRange(entry.createdAt, dateFrom, dateTo)).map((entry) => ({
      fecha: entry.createdAt,
      cuenta: accountName(entry.accountId),
      usuario: userName(entry.userId),
      producto: entry.productName,
      cantidad: entry.quantity,
      precio_unitario: entry.unitPrice,
      total: entry.total,
      costo_total: entry.costTotal,
      costo_estado: entry.costStatus
    })),
    Pagos: payments.filter((entry) => inRange(entry.createdAt, dateFrom, dateTo)).map((entry) => ({
      fecha: entry.createdAt,
      cuenta: accountName(entry.accountId),
      destino: entry.targetType,
      usuario: entry.userId ? userName(entry.userId) : '',
      pagador: entry.paidByUserId ? userName(entry.paidByUserId) : '',
      monto: entry.amount,
      sin_aplicar: entry.unappliedAmount,
      nota: entry.note ?? ''
    })),
    Inventario: stocks.map((stock) => ({
      producto: productName(stock.productId),
      stock: stock.stock,
      stock_minimo: stock.stockMin,
      bajo: stock.isLow
    })),
    Productos: products.map((product) => ({
      nombre: product.name,
      categoria: product.category,
      precio: product.price,
      ultimo_costo: product.lastCost,
      stock_minimo: product.stockMin,
      imagen: product.imageUrl ?? '',
      fuente_imagen: product.imageSourceUrl ?? '',
      credito_imagen: product.imageCredit ?? '',
      estado: product.status
    })),
    CuentasUsuarios: users.map((user) => ({
      cuenta: accountName(user.accountId),
      usuario: user.name,
      estado: user.status
    })),
    Compras: purchases.filter((entry) => inRange(entry.createdAt, dateFrom, dateTo)).map((entry) => ({
      fecha: entry.createdAt,
      producto: productName(entry.productId),
      cantidad: entry.quantity,
      costo_unitario: entry.unitCost,
      total: entry.totalCost,
      nota: entry.note ?? ''
    }))
  };
}

export async function exportToGoogleSheets(input: {
  sheetId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<{ status: 'exported' | 'skipped' | 'downloaded'; message: string }> {
  const rows = await buildExportRows(input.dateFrom, input.dateTo);
  const rowsHash = hashPayload(rows);
  const previous = await db.exportBatches
    .where('rowsHash')
    .equals(rowsHash)
    .filter((batch) => batch.sheetId === input.sheetId && batch.dateFrom === input.dateFrom && batch.dateTo === input.dateTo)
    .first();

  if (previous?.status === 'synced') {
    return { status: 'skipped', message: 'Este rango ya fue exportado sin cambios.' };
  }

  const exportFunctionUrl = import.meta.env.VITE_EXPORT_FUNCTION_URL;
  const batchId = createId('exp');

  if (!exportFunctionUrl) {
    const blob = new Blob([JSON.stringify({ sheetId: input.sheetId, dateFrom: input.dateFrom, dateTo: input.dateTo, rows }, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `app-tienda-export-${input.dateFrom}-${input.dateTo}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    await db.exportBatches.add({
      id: batchId,
      sheetId: input.sheetId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      rowsHash,
      status: 'failed',
      error: 'VITE_EXPORT_FUNCTION_URL no configurado; se descargó JSON local.',
      createdAt: nowIso()
    });
    return {
      status: 'downloaded',
      message: 'No hay función de Sheets configurada. Se descargó un JSON con los datos.'
    };
  }

  const response = await fetch(exportFunctionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheetId: input.sheetId, dateFrom: input.dateFrom, dateTo: input.dateTo, rows })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    await db.exportBatches.add({
      id: batchId,
      sheetId: input.sheetId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      rowsHash,
      status: 'failed',
      error: body.error ?? response.statusText,
      createdAt: nowIso()
    });
    throw new Error(body.error ?? 'No se pudo exportar a Google Sheets.');
  }

  await db.exportBatches.add({
    id: batchId,
    sheetId: input.sheetId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    rowsHash,
    status: 'synced',
    createdAt: nowIso(),
    exportedAt: nowIso()
  });

  return { status: 'exported', message: 'Exportacion enviada a Google Sheets.' };
}
