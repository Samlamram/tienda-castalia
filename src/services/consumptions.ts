import { db } from '../data/db';
import type { AppSession, CartItem, PendingConsumption, PendingConsumptionStatus } from '../domain/types';
import { createConsumption as createLocalConsumption } from './operations';
import { createId, nowIso } from '../utils/id';
import { getCachedCatalogVersion } from './catalog';
import { getSupabaseClient, isSyncConfigured } from './sync';

export type ConsumptionSubmitResult = {
  status: 'confirmed' | 'pending' | 'needs_review';
  message: string;
  serverConsumptionId?: string;
};

function online(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function normalizeCart(cart: CartItem[]): CartItem[] {
  return cart
    .map((item) => ({ productId: item.productId, quantity: Math.max(0, Number(item.quantity) || 0) }))
    .filter((item) => item.quantity > 0);
}

function resultFromRpc(value: unknown): ConsumptionSubmitResult {
  const row = (value ?? {}) as Record<string, unknown>;
  const status = row.status === 'needs_review' ? 'needs_review' : 'confirmed';
  return {
    status,
    message:
      typeof row.message === 'string'
        ? row.message
        : status === 'needs_review'
          ? 'Compra enviada para revision.'
          : 'Compra confirmada.',
    serverConsumptionId: row.consumptionId || row.consumption_id ? String(row.consumptionId ?? row.consumption_id) : undefined
  };
}

async function savePending(
  session: AppSession,
  cart: CartItem[],
  status: PendingConsumptionStatus,
  error?: string
): Promise<PendingConsumption> {
  const timestamp = nowIso();
  const pending: PendingConsumption = {
    id: createId('pending_con'),
    clientOperationId: createId('client_con'),
    sessionUserId: session.userId,
    accountId: session.accountId,
    deviceId: session.deviceId,
    catalogVersion: await getCachedCatalogVersion(),
    items: normalizeCart(cart),
    status,
    attempts: 0,
    error,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await db.pendingConsumptions.add(pending);
  return pending;
}

async function submitPendingConsumption(session: AppSession, pending: PendingConsumption): Promise<ConsumptionSubmitResult> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');

  await db.pendingConsumptions.put({
    ...pending,
    status: 'sending',
    attempts: pending.attempts + 1,
    error: undefined,
    updatedAt: nowIso()
  });

  const { data, error } = await supabase.rpc('create_consumption', {
    p_session_token: session.token,
    p_client_operation_id: pending.clientOperationId,
    p_device_id: pending.deviceId,
    p_catalog_version: pending.catalogVersion,
    p_items: pending.items
  });

  if (error) {
    const failed: PendingConsumption = {
      ...pending,
      attempts: pending.attempts + 1,
      status: online() ? 'failed' : 'pending',
      error: error.message,
      updatedAt: nowIso()
    };
    await db.pendingConsumptions.put(failed);
    throw new Error(error.message);
  }

  const result = resultFromRpc(data);
  await db.pendingConsumptions.put({
    ...pending,
    attempts: pending.attempts + 1,
    status: result.status === 'needs_review' ? 'needs_review' : 'confirmed',
    serverConsumptionId: result.serverConsumptionId,
    submittedAt: nowIso(),
    updatedAt: nowIso()
  });
  return result;
}

export async function queueOrSubmitConsumption(
  session: AppSession | undefined,
  userId: string,
  cart: CartItem[]
): Promise<ConsumptionSubmitResult> {
  const normalizedCart = normalizeCart(cart);
  if (normalizedCart.length === 0) throw new Error('El carrito esta vacio.');

  if (!isSyncConfigured() || !session?.token || session.token.startsWith('local-')) {
    await createLocalConsumption(userId, normalizedCart);
    return { status: 'confirmed', message: 'Consumo confirmado.' };
  }

  const pending = await savePending(session, normalizedCart, online() ? 'sending' : 'pending');
  if (!online()) {
    return {
      status: 'pending',
      message: 'Compra guardada en este dispositivo. Se enviara cuando vuelva la conexion.'
    };
  }

  try {
    return await submitPendingConsumption(session, pending);
  } catch (error) {
    return {
      status: 'pending',
      message:
        error instanceof Error
          ? `No se pudo confirmar ahora. Quedo pendiente: ${error.message}`
          : 'No se pudo confirmar ahora. Quedo pendiente.'
    };
  }
}

export async function syncPendingConsumptions(session: AppSession | null | undefined): Promise<{
  submitted: number;
  failed: number;
  pending: number;
}> {
  if (!session || !isSyncConfigured() || !online()) return { submitted: 0, failed: 0, pending: 0 };
  const rows = await db.pendingConsumptions
    .where('status')
    .anyOf(['pending', 'failed'])
    .filter((entry) => entry.sessionUserId === session.userId)
    .sortBy('createdAt');

  let submitted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await submitPendingConsumption(session, row);
      submitted += 1;
    } catch {
      failed += 1;
    }
  }

  const pending = await db.pendingConsumptions
    .where('status')
    .anyOf(['pending', 'failed'])
    .filter((entry) => entry.sessionUserId === session.userId)
    .count();

  return { submitted, failed, pending };
}
