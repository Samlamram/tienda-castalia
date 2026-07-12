import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db } from '../data/db';
import type { SyncOperation } from '../domain/types';

let client: SupabaseClient | null = null;

const entityTables: Record<string, keyof typeof db> = {
  accounts: 'accounts',
  users: 'users',
  products: 'products',
  consumptions: 'consumptions',
  consumption_items: 'consumptionItems',
  payments: 'payments',
  payment_applications: 'paymentApplications',
  purchases: 'purchases',
  inventory_lots: 'inventoryLots',
  inventory_movements: 'inventoryMovements',
  adjustments: 'adjustments',
  account_transfers: 'accountTransfers'
};

export function getSupabaseClient(): SupabaseClient | null {
  if (import.meta.env.MODE === 'test') return null;
  if (isDemoDataEnabled()) return null;
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  client = createClient(url, anonKey);
  return client;
}

export function isSyncConfigured(): boolean {
  if (import.meta.env.MODE === 'test') return false;
  if (isDemoDataEnabled()) return false;
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function isDemoDataEnabled(): boolean {
  return import.meta.env.VITE_USE_DEMO_DATA === 'true';
}

export async function pushPendingOperations(): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) return 0;
  const pending = await db.syncOperations.where('status').equals('pending').sortBy('createdAt');
  let synced = 0;

  for (const operation of pending) {
    const { error } = await supabase.from('sync_operations').upsert({
      id: operation.id,
      entity: operation.entity,
      entity_id: operation.entityId,
      action: operation.action,
      payload: operation.payload,
      created_at: operation.createdAt
    });

    if (error) {
      await db.syncOperations.put({
        ...operation,
        status: 'failed',
        attempts: operation.attempts + 1,
        error: error.message
      });
      continue;
    }

    synced += 1;
    await db.syncOperations.put({
      ...operation,
      status: 'synced',
      attempts: operation.attempts + 1,
      syncedAt: new Date().toISOString(),
      error: undefined
    });
  }

  return synced;
}

async function applyRemoteOperation(operation: SyncOperation): Promise<void> {
  const tableName = entityTables[operation.entity];
  if (!tableName || operation.action !== 'upsert') return;
  const table = db[tableName] as unknown as { put: (value: unknown) => Promise<unknown> };
  await table.put(operation.payload);
}

export async function pullRemoteOperations(): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) return 0;
  const lastSync = await db.settings.get('last_remote_sync_at');
  const query = supabase.from('sync_operations').select('*').order('created_at', { ascending: true }).limit(500);
  const { data, error } = lastSync?.value
    ? await query.gt('created_at', lastSync.value)
    : await query;

  if (error) throw new Error(error.message);
  if (!data?.length) return 0;

  const operations: SyncOperation[] = data.map((row) => ({
    id: row.id,
    entity: row.entity,
    entityId: row.entity_id,
    action: row.action,
    payload: row.payload,
    status: 'synced',
    attempts: 1,
    createdAt: row.created_at,
    syncedAt: row.created_at
  }));

  await db.transaction(
    'rw',
    [
      db.accounts,
      db.users,
      db.products,
      db.consumptions,
      db.consumptionItems,
      db.payments,
      db.paymentApplications,
      db.purchases,
      db.inventoryLots,
      db.inventoryMovements,
      db.adjustments,
      db.accountTransfers,
      db.settings
    ],
    async () => {
      for (const operation of operations) {
        await applyRemoteOperation(operation);
      }
      await db.settings.put({
        key: 'last_remote_sync_at',
        value: operations[operations.length - 1].createdAt
      });
    }
  );

  return operations.length;
}

export async function syncNow(): Promise<{ pushed: number; pulled: number }> {
  if (!navigator.onLine || !isSyncConfigured()) return { pushed: 0, pulled: 0 };
  const pushed = await pushPendingOperations();
  const pulled = await pullRemoteOperations();
  return { pushed, pulled };
}
