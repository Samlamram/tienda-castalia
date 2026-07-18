import { db } from '../data/db';
import type { AppSession, CartItem, PendingConsumption, PendingConsumptionStatus } from '../domain/types';
import { nowIso } from '../utils/id';
import { getCachedCatalogVersion } from './catalog';
import { getSupabaseClient, isSyncConfigured } from './sync';

export type ConsumptionSubmitResult = {
  status: 'confirmed' | 'pending' | 'needs_review';
  message: string;
  serverConsumptionId?: string;
  officialTotal?: number;
  requiresLogin?: boolean;
};

class ConsumptionSubmissionError extends Error {
  constructor(
    message: string,
    readonly needsReview: boolean,
    readonly requiresLogin: boolean
  ) {
    super(message);
  }
}

function classifySubmissionError(message: string): { needsReview: boolean; requiresLogin: boolean } {
  const normalized = message.toLocaleLowerCase('es-CO');
  const requiresLogin =
    normalized.includes('sesion invalida') ||
    normalized.includes('sesión inválida') ||
    normalized.includes('sesion expirada') ||
    normalized.includes('sesión expirada') ||
    normalized.includes('inicia sesion') ||
    normalized.includes('inicia sesión');
  const needsReview = normalized.includes('producto no disponible') ||
    normalized.includes('cuenta inactiva') ||
    normalized.includes('usuario inactivo') ||
    normalized.includes('revision') ||
    normalized.includes('revisión');
  return { needsReview, requiresLogin };
}

function online(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function normalizeCart(cart: CartItem[]): CartItem[] {
  return cart
    .map((item) => ({ productId: item.productId, quantity: Math.max(0, Number(item.quantity) || 0) }))
    .filter((item) => item.quantity > 0);
}

function resultFromRpc(value: unknown): ConsumptionSubmitResult {
  const payload = Array.isArray(value) ? value[0] : value;
  const row = (payload ?? {}) as Record<string, unknown>;
  const status = row.status === 'needs_review' ? 'needs_review' : 'confirmed';
  const officialTotal = Number(row.total ?? row.officialTotal ?? row.official_total);
  return {
    status,
    message:
      typeof row.message === 'string'
        ? row.message
        : status === 'needs_review'
          ? 'Compra enviada para revision.'
          : 'Compra confirmada.',
    serverConsumptionId: row.consumptionId || row.consumption_id ? String(row.consumptionId ?? row.consumption_id) : undefined,
    officialTotal: Number.isFinite(officialTotal) ? officialTotal : undefined
  };
}

async function savePending(
  session: AppSession,
  cart: CartItem[],
  status: PendingConsumptionStatus,
  error?: string
): Promise<PendingConsumption> {
  const timestamp = nowIso();
  const clientOperationId = crypto.randomUUID();
  const catalogProducts = await db.catalogProducts.bulkGet(cart.map((item) => item.productId));
  const displayItems = cart.map((item, index) => {
    const product = catalogProducts[index];
    const unitPrice = product?.price ?? 0;
    return {
      productId: item.productId,
      productName: product?.name ?? 'Producto',
      quantity: item.quantity,
      unitPrice,
      total: item.quantity * unitPrice
    };
  });
  const pending: PendingConsumption = {
    id: clientOperationId,
    clientOperationId,
    sessionUserId: session.userId,
    accountId: session.accountId,
    deviceId: session.deviceId,
    catalogVersion: await getCachedCatalogVersion(),
    items: normalizeCart(cart),
    displayItems,
    estimatedTotal: displayItems.reduce((sum, item) => sum + item.total, 0),
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

  const attempts = pending.attempts + 1;
  await db.pendingConsumptions.put({
    ...pending,
    status: 'sending',
    attempts,
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
    const classification = classifySubmissionError(error.message);
    const failed: PendingConsumption = {
      ...pending,
      attempts,
      status: classification.requiresLogin
        ? 'pending'
        : classification.needsReview
          ? 'needs_review'
          : online()
            ? 'failed'
            : 'pending',
      error: error.message,
      updatedAt: nowIso()
    };
    await db.pendingConsumptions.put(failed);
    throw new ConsumptionSubmissionError(
      error.message,
      classification.needsReview,
      classification.requiresLogin
    );
  }

  const result = resultFromRpc(data);
  if (result.status === 'confirmed') {
    await db.pendingConsumptions.delete(pending.id);
  } else {
    await db.pendingConsumptions.put({
      ...pending,
      attempts,
      status: 'needs_review',
      serverConsumptionId: result.serverConsumptionId,
      submittedAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  return result;
}

export async function queueOrSubmitConsumption(
  session: AppSession | undefined,
  userId: string,
  cart: CartItem[]
): Promise<ConsumptionSubmitResult> {
  const normalizedCart = normalizeCart(cart);
  if (normalizedCart.length === 0) throw new Error('El carrito esta vacio.');
  if (!session?.token) throw new Error('Inicia sesion antes de registrar una compra.');
  if (session.role !== 'user') throw new Error('Solo los usuarios pueden registrar compras.');
  if (session.userId !== userId) throw new Error('La sesion no corresponde al usuario de la compra.');
  if (!isSyncConfigured()) {
    throw new Error('Supabase no esta configurado. La compra no puede sincronizarse.');
  }

  const pending = await savePending(session, normalizedCart, 'pending');
  if (!online()) {
    return {
      status: 'pending',
      message: 'Compra guardada en este dispositivo. Se enviara cuando vuelva la conexion.'
    };
  }

  try {
    return await submitPendingConsumption(session, pending);
  } catch (error) {
    if (error instanceof ConsumptionSubmissionError && (error.needsReview || error.requiresLogin)) {
      return {
        status: error.requiresLogin ? 'pending' : 'needs_review',
        message: error.requiresLogin
          ? `La compra quedó guardada, pero debes iniciar sesión de nuevo: ${error.message}`
          : `La compra requiere revisión antes de reenviarse: ${error.message}`,
        requiresLogin: error.requiresLogin
      };
    }
    return {
      status: 'pending',
      message:
        error instanceof Error
          ? `No se pudo confirmar ahora. Quedo pendiente: ${error.message}`
          : 'No se pudo confirmar ahora. Quedo pendiente.'
    };
  }
}

export async function retryReviewedConsumption(
  session: AppSession | undefined,
  pendingId: string
): Promise<ConsumptionSubmitResult> {
  if (!session?.token || session.role !== 'user') throw new Error('Inicia sesión para reintentar la compra.');
  const pending = await db.pendingConsumptions.get(pendingId);
  if (!pending || pending.sessionUserId !== session.userId || pending.status !== 'needs_review') {
    throw new Error('La compra pendiente ya no está disponible para revisión.');
  }

  await db.pendingConsumptions.put({ ...pending, status: 'pending', error: undefined, updatedAt: nowIso() });
  if (!online()) {
    return { status: 'pending', message: 'La compra volverá a intentarse cuando regrese la conexión.' };
  }

  try {
    return await submitPendingConsumption(session, pending);
  } catch (error) {
    if (error instanceof ConsumptionSubmissionError) {
      return {
        status: error.requiresLogin ? 'pending' : error.needsReview ? 'needs_review' : 'pending',
        message: error.requiresLogin
          ? `La sesión venció; la compra sigue guardada: ${error.message}`
          : error.needsReview
            ? `La compra todavía requiere revisión: ${error.message}`
            : `No se pudo confirmar ahora. Quedó pendiente: ${error.message}`,
        requiresLogin: error.requiresLogin
      };
    }
    return {
      status: 'pending',
      message: error instanceof Error ? `No se pudo confirmar ahora: ${error.message}` : 'No se pudo confirmar ahora.'
    };
  }
}

export async function discardReviewedConsumption(userId: string, pendingId: string): Promise<void> {
  const pending = await db.pendingConsumptions.get(pendingId);
  if (!pending || pending.sessionUserId !== userId || pending.status !== 'needs_review') {
    throw new Error('La compra pendiente ya no está disponible para descartar.');
  }
  await db.pendingConsumptions.delete(pendingId);
}

export async function syncPendingConsumptions(session: AppSession | null | undefined): Promise<{
  submitted: number;
  failed: number;
  pending: number;
  requiresLogin?: boolean;
}> {
  if (!session || !isSyncConfigured() || !online()) return { submitted: 0, failed: 0, pending: 0 };
  if (session.role !== 'user') return { submitted: 0, failed: 0, pending: 0 };

  const rows = await db.pendingConsumptions
    .where('status')
    .anyOf(['pending', 'failed', 'sending'])
    .filter((entry) => entry.sessionUserId === session.userId)
    .sortBy('createdAt');

  let submitted = 0;
  let failed = 0;
  let requiresLogin = false;
  for (const row of rows) {
    try {
      await submitPendingConsumption(session, row);
      submitted += 1;
    } catch (error) {
      failed += 1;
      if (error instanceof ConsumptionSubmissionError && error.requiresLogin) {
        requiresLogin = true;
        break;
      }
    }
  }

  const pending = await db.pendingConsumptions
    .where('status')
    .anyOf(['pending', 'failed', 'sending'])
    .filter((entry) => entry.sessionUserId === session.userId)
    .count();

  return requiresLogin
    ? { submitted, failed, pending, requiresLogin: true }
    : { submitted, failed, pending };
}
