import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import type { AppSession, PendingConsumption, TiendaViewData } from '../domain/types';
import { cachedUserViewData } from '../domain/viewData';

export function useCloudUserData(inputSession?: AppSession | null): TiendaViewData {
  const storedSession = useLiveQuery(() => db.appSessions.get('current'), [], inputSession ?? null);
  const catalogProducts = useLiveQuery(() => db.catalogProducts.orderBy('name').toArray(), [], []);
  const pendingConsumptions = useLiveQuery<PendingConsumption[], PendingConsumption[]>(
    () => {
      const userId = inputSession?.userId;
      if (!userId) return Promise.resolve([] as PendingConsumption[]);
      return db.pendingConsumptions
        .where('sessionUserId')
        .equals(userId)
        .sortBy('createdAt');
    },
    [inputSession?.userId],
    []
  );
  const settings = useLiveQuery(() => db.settings.toArray(), [], []);

  return cachedUserViewData({
    session: storedSession ?? inputSession ?? null,
    products: catalogProducts,
    pendingConsumptions,
    settings
  });
}
