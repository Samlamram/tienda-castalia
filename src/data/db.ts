import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSession,
  CatalogProduct,
  PendingConsumption,
  Setting
} from '../domain/types';

export const LOCAL_DATABASE_NAME = 'app_tienda_v2';
export const LEGACY_LOCAL_DATABASE_NAME = 'app_tienda_v1';
const LEGACY_CLEANUP_SETTING = 'legacy_v1_removed';

/**
 * The browser database is only an offline cache/outbox. Business and
 * administrative records always come from Supabase and are kept in memory.
 */
export class TiendaDatabase extends Dexie {
  appSessions!: EntityTable<AppSession, 'key'>;
  catalogProducts!: EntityTable<CatalogProduct, 'id'>;
  pendingConsumptions!: EntityTable<PendingConsumption, 'id'>;
  settings!: EntityTable<Setting, 'key'>;

  constructor() {
    super(LOCAL_DATABASE_NAME);
    this.version(1).stores({
      appSessions: 'key, role, userId, expiresAt, updatedAt',
      catalogProducts: 'id, status, category, name, version, updatedAt',
      pendingConsumptions:
        'id, &clientOperationId, sessionUserId, accountId, status, createdAt, updatedAt',
      settings: 'key'
    });
  }
}

export const db = new TiendaDatabase();

/**
 * Opens v2 first and then retires the demo-era database. Cleanup is idempotent;
 * callers may retry it after another browser tab releases the legacy database.
 */
export async function initializeLocalDatabase(): Promise<void> {
  await db.open();
  if ((await db.settings.get(LEGACY_CLEANUP_SETTING))?.value === 'true') return;

  await Dexie.delete(LEGACY_LOCAL_DATABASE_NAME);
  await db.settings.put({ key: LEGACY_CLEANUP_SETTING, value: 'true' });
}
