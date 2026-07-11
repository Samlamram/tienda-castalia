import { db } from '../data/db';
import type {
  Account,
  AccountTransfer,
  AppSession,
  BalanceAdjustment,
  Consumption,
  ConsumptionItem,
  InventoryMovement,
  Payment,
  PaymentApplication,
  PersonUser,
  Product,
  Purchase
} from '../domain/types';
import { createId, nowIso } from '../utils/id';
import { getSupabaseClient, isSyncConfigured } from './sync';
import * as localOps from './operations';

type SnapshotPayload = {
  accounts?: unknown[];
  users?: unknown[];
  products?: unknown[];
  consumptions?: unknown[];
  consumptionItems?: unknown[];
  consumption_items?: unknown[];
  payments?: unknown[];
  paymentApplications?: unknown[];
  payment_applications?: unknown[];
  purchases?: unknown[];
  inventoryMovements?: unknown[];
  inventory_movements?: unknown[];
  adjustments?: unknown[];
  accountTransfers?: unknown[];
  account_transfers?: unknown[];
};

function shouldUseCloud(session?: AppSession): boolean {
  return Boolean(isSyncConfigured() && session?.token && !session.token.startsWith('local-'));
}

function s(row: Record<string, unknown>, camel: string, snake = camel, fallback = ''): string {
  const value = row[camel] ?? row[snake];
  return typeof value === 'string' ? value : fallback;
}

function n(row: Record<string, unknown>, camel: string, snake = camel, fallback = 0): number {
  const value = Number(row[camel] ?? row[snake]);
  return Number.isFinite(value) ? value : fallback;
}

function opt(row: Record<string, unknown>, camel: string, snake = camel): string | undefined {
  const value = row[camel] ?? row[snake];
  return typeof value === 'string' && value ? value : undefined;
}

function row(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function mapAccount(value: unknown): Account {
  const item = row(value);
  return {
    id: s(item, 'id'),
    name: s(item, 'name'),
    status: item.status === 'inactive' ? 'inactive' : 'active',
    createdAt: s(item, 'createdAt', 'created_at', nowIso()),
    updatedAt: s(item, 'updatedAt', 'updated_at', nowIso()),
    version: n(item, 'version', 'version', 1)
  };
}

function mapUser(value: unknown): PersonUser {
  const item = row(value);
  return {
    id: s(item, 'id'),
    accountId: opt(item, 'accountId', 'account_id'),
    name: s(item, 'name'),
    username: opt(item, 'username'),
    role: item.role === 'admin' ? 'admin' : 'user',
    pinHash: s(item, 'pinHash', 'pin_hash'),
    status: item.status === 'inactive' ? 'inactive' : 'active',
    createdAt: s(item, 'createdAt', 'created_at', nowIso()),
    updatedAt: s(item, 'updatedAt', 'updated_at', nowIso()),
    version: n(item, 'version', 'version', 1)
  };
}

function mapProduct(value: unknown): Product {
  const item = row(value);
  return {
    id: s(item, 'id'),
    name: s(item, 'name'),
    category: s(item, 'category', 'category', 'General'),
    price: n(item, 'price'),
    stockMin: n(item, 'stockMin', 'stock_min'),
    lastCost: n(item, 'lastCost', 'last_cost'),
    imageUrl: opt(item, 'imageUrl', 'image_url'),
    imageSourceUrl: opt(item, 'imageSourceUrl', 'image_source_url'),
    imageCredit: opt(item, 'imageCredit', 'image_credit'),
    status: item.status === 'inactive' ? 'inactive' : 'active',
    createdAt: s(item, 'createdAt', 'created_at', nowIso()),
    updatedAt: s(item, 'updatedAt', 'updated_at', nowIso()),
    version: n(item, 'version', 'version', 1)
  };
}

function mapConsumption(value: unknown): Consumption {
  const item = row(value);
  return {
    id: s(item, 'id'),
    accountId: opt(item, 'accountId', 'account_id'),
    userId: s(item, 'userId', 'user_id'),
    status: item.status === 'voided' ? 'voided' : 'confirmed',
    total: n(item, 'total'),
    costTotal: n(item, 'costTotal', 'cost_total'),
    costStatus: item.costStatus === 'final' || item.cost_status === 'final' ? 'final' : 'pending_recalc',
    createdAt: s(item, 'createdAt', 'created_at', nowIso()),
    voidedAt: opt(item, 'voidedAt', 'voided_at'),
    voidReason: opt(item, 'voidReason', 'void_reason')
  };
}

function mapConsumptionItem(value: unknown): ConsumptionItem {
  const item = row(value);
  return {
    id: s(item, 'id'),
    consumptionId: s(item, 'consumptionId', 'consumption_id'),
    accountId: opt(item, 'accountId', 'account_id'),
    userId: s(item, 'userId', 'user_id'),
    productId: s(item, 'productId', 'product_id'),
    productName: s(item, 'productName', 'product_name'),
    quantity: n(item, 'quantity'),
    unitPrice: n(item, 'unitPrice', 'unit_price'),
    total: n(item, 'total'),
    unitCost: n(item, 'unitCost', 'unit_cost'),
    costTotal: n(item, 'costTotal', 'cost_total'),
    pendingCostQuantity: n(item, 'pendingCostQuantity', 'pending_cost_quantity'),
    costStatus: item.costStatus === 'final' || item.cost_status === 'final' ? 'final' : 'pending_recalc',
    createdAt: s(item, 'createdAt', 'created_at', nowIso())
  };
}

function mapPayment(value: unknown): Payment {
  const item = row(value);
  return {
    id: s(item, 'id'),
    accountId: opt(item, 'accountId', 'account_id'),
    targetType: item.targetType === 'user' || item.target_type === 'user' ? 'user' : 'account',
    userId: opt(item, 'userId', 'user_id'),
    paidByUserId: opt(item, 'paidByUserId', 'paid_by_user_id'),
    amount: n(item, 'amount'),
    unappliedAmount: n(item, 'unappliedAmount', 'unapplied_amount'),
    note: opt(item, 'note'),
    createdAt: s(item, 'createdAt', 'created_at', nowIso())
  };
}

function mapPaymentApplication(value: unknown): PaymentApplication {
  const item = row(value);
  return {
    id: s(item, 'id'),
    paymentId: s(item, 'paymentId', 'payment_id'),
    accountId: opt(item, 'accountId', 'account_id'),
    userId: s(item, 'userId', 'user_id'),
    consumptionItemId: s(item, 'consumptionItemId', 'consumption_item_id'),
    amount: n(item, 'amount'),
    createdAt: s(item, 'createdAt', 'created_at', nowIso())
  };
}

function mapPurchase(value: unknown): Purchase {
  const item = row(value);
  return {
    id: s(item, 'id'),
    productId: s(item, 'productId', 'product_id'),
    quantity: n(item, 'quantity'),
    unitCost: n(item, 'unitCost', 'unit_cost'),
    totalCost: n(item, 'totalCost', 'total_cost'),
    note: opt(item, 'note'),
    createdAt: s(item, 'createdAt', 'created_at', nowIso())
  };
}

function mapMovement(value: unknown): InventoryMovement {
  const item = row(value);
  const type = s(item, 'type');
  return {
    id: s(item, 'id'),
    productId: s(item, 'productId', 'product_id'),
    type:
      type === 'purchase' ||
      type === 'consumption' ||
      type === 'void_consumption' ||
      type === 'adjustment' ||
    type === 'cost_recalc'
        ? type
        : 'adjustment',
    quantityDelta: n(item, 'quantityDelta', 'quantity_delta'),
    unitCost: 'unitCost' in item || 'unit_cost' in item ? n(item, 'unitCost', 'unit_cost') : undefined,
    referenceId: opt(item, 'referenceId', 'reference_id'),
    note: opt(item, 'note'),
    createdAt: s(item, 'createdAt', 'created_at', nowIso())
  };
}

function mapAdjustment(value: unknown): BalanceAdjustment {
  const item = row(value);
  return {
    id: s(item, 'id'),
    accountId: opt(item, 'accountId', 'account_id'),
    scope: item.scope === 'user' ? 'user' : 'account',
    userId: opt(item, 'userId', 'user_id'),
    amount: n(item, 'amount'),
    note: s(item, 'note'),
    createdAt: s(item, 'createdAt', 'created_at', nowIso())
  };
}

function mapTransfer(value: unknown): AccountTransfer {
  const item = row(value);
  return {
    id: s(item, 'id'),
    userId: s(item, 'userId', 'user_id'),
    fromAccountId: opt(item, 'fromAccountId', 'from_account_id'),
    toAccountId: opt(item, 'toAccountId', 'to_account_id'),
    movedBalance: n(item, 'movedBalance', 'moved_balance'),
    note: s(item, 'note'),
    createdAt: s(item, 'createdAt', 'created_at', nowIso())
  };
}

async function adminCommand<T = unknown>(
  session: AppSession | undefined,
  command: string,
  payload: Record<string, unknown>
): Promise<T | null> {
  if (!shouldUseCloud(session)) return null;
  const supabase = getSupabaseClient();
  if (!supabase || !session) throw new Error('Supabase no esta configurado.');

  const { data, error } = await supabase.rpc('admin_command', {
    p_session_token: session.token,
    p_idempotency_key: createId('adm'),
    p_command: command,
    p_payload: payload
  });

  if (error) throw new Error(error.message);
  await loadAdminSnapshot(session);
  return data as T;
}

export async function loadAdminSnapshot(session: AppSession | undefined): Promise<void> {
  if (!shouldUseCloud(session)) return;
  const supabase = getSupabaseClient();
  if (!supabase || !session) throw new Error('Supabase no esta configurado.');

  const { data, error } = await supabase.rpc('admin_get_snapshot', {
    p_session_token: session.token
  });

  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as SnapshotPayload;
  const consumptionItems = payload.consumptionItems ?? payload.consumption_items ?? [];
  const paymentApplications = payload.paymentApplications ?? payload.payment_applications ?? [];
  const inventoryMovements = payload.inventoryMovements ?? payload.inventory_movements ?? [];
  const accountTransfers = payload.accountTransfers ?? payload.account_transfers ?? [];

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
      db.inventoryMovements,
      db.adjustments,
      db.accountTransfers
    ],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.users.clear(),
        db.products.clear(),
        db.consumptions.clear(),
        db.consumptionItems.clear(),
        db.payments.clear(),
        db.paymentApplications.clear(),
        db.purchases.clear(),
        db.inventoryMovements.clear(),
        db.adjustments.clear(),
        db.accountTransfers.clear()
      ]);
      await db.accounts.bulkPut((payload.accounts ?? []).map(mapAccount));
      await db.users.bulkPut((payload.users ?? []).map(mapUser));
      await db.products.bulkPut((payload.products ?? []).map(mapProduct));
      await db.consumptions.bulkPut((payload.consumptions ?? []).map(mapConsumption));
      await db.consumptionItems.bulkPut(consumptionItems.map(mapConsumptionItem));
      await db.payments.bulkPut((payload.payments ?? []).map(mapPayment));
      await db.paymentApplications.bulkPut(paymentApplications.map(mapPaymentApplication));
      await db.purchases.bulkPut((payload.purchases ?? []).map(mapPurchase));
      await db.inventoryMovements.bulkPut(inventoryMovements.map(mapMovement));
      await db.adjustments.bulkPut((payload.adjustments ?? []).map(mapAdjustment));
      await db.accountTransfers.bulkPut(accountTransfers.map(mapTransfer));
    }
  );
}

export async function createAccount(input: { name: string }, session?: AppSession): Promise<Account | null> {
  if (shouldUseCloud(session)) return adminCommand<Account>(session, 'create_account', input);
  return localOps.createAccount(input.name);
}

export async function updateAccount(account: Account, session?: AppSession): Promise<void> {
  if (shouldUseCloud(session)) {
    await adminCommand(session, 'update_account', account as unknown as Record<string, unknown>);
    return;
  }
  await localOps.updateAccount(account);
}

export async function createUser(
  input: { accountId?: string; name: string; username?: string; pin: string; role?: 'admin' | 'user' },
  session?: AppSession
): Promise<PersonUser | null> {
  if (shouldUseCloud(session)) return adminCommand<PersonUser>(session, 'create_user', input);
  return localOps.createUser({ accountId: input.accountId, name: input.name, pin: input.pin });
}

export async function updateUser(input: PersonUser & { newPin?: string }, session?: AppSession): Promise<void> {
  if (shouldUseCloud(session)) {
    await adminCommand(session, 'update_user', input as unknown as Record<string, unknown>);
    return;
  }
  await localOps.updateUser(input);
}

export async function createProduct(
  input: {
    name: string;
    category: string;
    price: number;
    stockMin: number;
    lastCost: number;
    imageUrl?: string;
    imageSourceUrl?: string;
    imageCredit?: string;
  },
  session?: AppSession
): Promise<Product | null> {
  if (shouldUseCloud(session)) return adminCommand<Product>(session, 'create_product', input);
  return localOps.createProduct(input);
}

export async function updateProduct(product: Product, session?: AppSession): Promise<void> {
  if (shouldUseCloud(session)) {
    await adminCommand(session, 'update_product', product as unknown as Record<string, unknown>);
    return;
  }
  await localOps.updateProduct(product);
}

export async function createPurchase(
  input: { productId: string; quantity: number; unitCost: number; note?: string },
  session?: AppSession
): Promise<Purchase | null> {
  if (shouldUseCloud(session)) return adminCommand<Purchase>(session, 'create_purchase', input);
  return localOps.createPurchase(input);
}

export async function createPayment(
  input: { accountId?: string; targetType: 'account' | 'user'; userId?: string; paidByUserId?: string; amount: number; note?: string },
  session?: AppSession
): Promise<Payment | null> {
  if (shouldUseCloud(session)) return adminCommand<Payment>(session, 'create_payment', input);
  return localOps.createPayment(input);
}

export async function createBalanceAdjustment(
  input: { accountId: string; scope: 'account' | 'user'; userId?: string; amount: number; note: string },
  session?: AppSession
): Promise<BalanceAdjustment | null> {
  if (shouldUseCloud(session)) return adminCommand<BalanceAdjustment>(session, 'create_adjustment', input);
  return localOps.createBalanceAdjustment(input);
}

export async function adjustInventory(
  input: { productId: string; quantityDelta: number; note: string },
  session?: AppSession
): Promise<void> {
  if (shouldUseCloud(session)) {
    await adminCommand(session, 'adjust_inventory', input);
    return;
  }
  await localOps.adjustInventory(input);
}

export async function voidConsumption(consumptionId: string, reason: string, session?: AppSession): Promise<void> {
  if (shouldUseCloud(session)) {
    await adminCommand(session, 'void_consumption', { consumptionId, reason });
    return;
  }
  await localOps.voidConsumption(consumptionId, reason);
}

export async function independizeUser(
  userId: string,
  newAccountName: string,
  session?: AppSession
): Promise<AccountTransfer | null> {
  if (shouldUseCloud(session)) return adminCommand<AccountTransfer>(session, 'independize_user', { userId, newAccountName });
  return localOps.independizeUser(userId, newAccountName);
}

export async function mergeAccounts(sourceAccountId: string, targetAccountId: string, session?: AppSession): Promise<void> {
  if (shouldUseCloud(session)) {
    await adminCommand(session, 'merge_accounts', { sourceAccountId, targetAccountId });
    return;
  }
  await localOps.mergeAccounts(sourceAccountId, targetAccountId);
}

export async function assignUserToAccount(userId: string, accountId: string, session?: AppSession): Promise<void> {
  if (shouldUseCloud(session)) {
    await adminCommand(session, 'assign_user_to_account', { userId, accountId });
    return;
  }
  await localOps.assignUserToAccount(userId, accountId);
}

export async function removeUserFromAccount(userId: string, session?: AppSession): Promise<void> {
  if (shouldUseCloud(session)) {
    await adminCommand(session, 'remove_user_from_account', { userId });
    return;
  }
  await localOps.removeUserFromAccount(userId);
}

export async function recalculateFifo(input: { productId?: string } = {}, session?: AppSession): Promise<void> {
  if (shouldUseCloud(session)) {
    await adminCommand(session, 'recalculate_fifo', input);
  }
}
