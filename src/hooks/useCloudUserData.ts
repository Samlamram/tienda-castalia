import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import type { Account, AccountBalance, AppSession, BalanceAdjustment, PersonUser, Product } from '../domain/types';
import { catalogProductToProduct } from '../services/catalog';

export function useCloudUserData(inputSession?: AppSession | null) {
  const storedSession = useLiveQuery(() => db.appSessions.get('current'), [], inputSession ?? null);
  const catalogProducts = useLiveQuery(() => db.catalogProducts.orderBy('name').toArray(), [], []);
  const pendingSync = useLiveQuery(
    () => {
      const userId = inputSession?.userId;
      if (!userId) return Promise.resolve(0);
      return db.pendingConsumptions
        .where('status')
        .anyOf(['pending', 'failed'])
        .filter((entry) => entry.sessionUserId === userId)
        .count();
    },
    [inputSession?.userId],
    0
  );
  const settings = useLiveQuery(() => db.settings.toArray(), [], []);
  const session = storedSession ?? inputSession ?? null;
  const timestamp = session?.updatedAt ?? new Date().toISOString();

  const accounts: Account[] = session?.accountId
    ? [
        {
          id: session.accountId,
          name: session.accountName ?? 'Cuenta',
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    : [];

  const users: PersonUser[] = session
    ? [
        {
          id: session.userId,
          accountId: session.accountId,
          name: session.userName,
          pinHash: '',
          role: session.role,
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    : [];

  const products: Product[] = catalogProducts.map(catalogProductToProduct);
  const balance = session?.balance ?? 0;
  const adjustments: BalanceAdjustment[] = session
    ? [
        {
          id: `session_balance_${session.userId}`,
          accountId: session.accountId,
          scope: 'user',
          userId: session.userId,
          amount: balance,
          note: 'Saldo actual',
          createdAt: timestamp
        }
      ]
    : [];
  const accountBalances: AccountBalance[] = session?.accountId
    ? [
        {
          accountId: session.accountId,
          consumed: balance,
          paid: 0,
          adjustments: 0,
          balance,
          unappliedCredit: 0,
          users: [
            {
              userId: session.userId,
              accountId: session.accountId,
              consumed: balance,
              paid: 0,
              adjustments: 0,
              balance
            }
          ]
        }
      ]
    : [];

  return {
    accounts,
    users,
    products,
    consumptions: [],
    items: [],
    payments: [],
    applications: [],
    purchases: [],
    movements: [],
    adjustments,
    pendingSync,
    settings,
    accountBalances,
    productStocks: products.map((product) => ({
      productId: product.id,
      stock: 0,
      stockMin: 0,
      isLow: false
    }))
  };
}
