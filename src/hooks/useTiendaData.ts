import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { calculateAccountBalance, calculateProductStocks } from '../domain/ledger';

export function useTiendaData() {
  const accounts = useLiveQuery(() => db.accounts.orderBy('name').toArray(), [], []);
  const users = useLiveQuery(() => db.users.orderBy('name').toArray(), [], []);
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [], []);
  const consumptions = useLiveQuery(() => db.consumptions.orderBy('createdAt').reverse().toArray(), [], []);
  const items = useLiveQuery(() => db.consumptionItems.orderBy('createdAt').reverse().toArray(), [], []);
  const payments = useLiveQuery(() => db.payments.orderBy('createdAt').reverse().toArray(), [], []);
  const applications = useLiveQuery(() => db.paymentApplications.toArray(), [], []);
  const purchases = useLiveQuery(() => db.purchases.orderBy('createdAt').reverse().toArray(), [], []);
  const movements = useLiveQuery(() => db.inventoryMovements.toArray(), [], []);
  const adjustments = useLiveQuery(() => db.adjustments.orderBy('createdAt').reverse().toArray(), [], []);
  const pendingSync = useLiveQuery(() => db.syncOperations.where('status').equals('pending').count(), [], 0);
  const settings = useLiveQuery(() => db.settings.toArray(), [], []);

  const accountBalances = accounts.map((account) =>
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
  const productStocks = calculateProductStocks(products, movements);

  return {
    accounts,
    users,
    products,
    consumptions,
    items,
    payments,
    applications,
    purchases,
    movements,
    adjustments,
    pendingSync,
    settings,
    accountBalances,
    productStocks
  };
}
