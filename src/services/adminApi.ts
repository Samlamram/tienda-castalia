import {
  calculateAccountBalance,
  calculateConsumptionCosts,
  calculateConsumptionPaymentStatuses,
  calculateProductStocks,
  calculateUserBalances
} from '../domain/ledger';
import type {
  Account,
  AdminSnapshot,
  AppSession,
  AuditLogEntry,
  AuditValues,
  Consumption,
  ConsumptionCost,
  ConsumptionItem,
  ConsumptionPaymentStatus,
  FifoCostAllocation,
  FinancialMovement,
  FinancialMovementType,
  InventoryMovement,
  InventoryMovementType,
  PaymentApplication,
  PersonUser,
  Product,
  ProductStock,
  UserBalance,
  AccountBalance
} from '../domain/types';
import { getSupabaseClient, isSyncConfigured } from './sync';

type JsonRow = Record<string, unknown>;

export interface AuditLogFilters {
  search?: string;
  action?: string;
  entityType?: string;
  actorUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
}

function row(value: unknown): JsonRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRow) : {};
}

function value(source: JsonRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function textValue(source: JsonRow, keys: string[], fallback = ''): string {
  const found = value(source, ...keys);
  return typeof found === 'string' ? found : fallback;
}

function optionalText(source: JsonRow, keys: string[]): string | undefined {
  const found = value(source, ...keys);
  return typeof found === 'string' && found.length > 0 ? found : undefined;
}

function numberValue(source: JsonRow, keys: string[], fallback = 0): number {
  const parsed = Number(value(source, ...keys));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function arrayValue(source: JsonRow, ...keys: string[]): unknown[] {
  const found = value(source, ...keys);
  return Array.isArray(found) ? found : [];
}

const SENSITIVE_AUDIT_KEYS = new Set([
  'authorization',
  'accesstoken',
  'currentpin',
  'hash',
  'newpin',
  'password',
  'pin',
  'pinhash',
  'pinsalt',
  'psessiontoken',
  'refreshtoken',
  'salt',
  'secret',
  'sessiontoken',
  'token',
  'tokenhash'
]);

function normalizedAuditKey(key: string): string {
  return key.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
}

function isSensitiveAuditKey(key: string): boolean {
  const normalized = normalizedAuditKey(key);
  return SENSITIVE_AUDIT_KEYS.has(normalized) ||
    normalized.endsWith('token') ||
    normalized.endsWith('tokenhash') ||
    normalized.endsWith('pinhash') ||
    normalized.endsWith('pinsalt');
}

function sanitizeAuditValue(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sanitizeAuditValue);
  if (!input || typeof input !== 'object') return input;

  return Object.fromEntries(
    Object.entries(input as JsonRow)
      .filter(([key]) => !isSensitiveAuditKey(key))
      .map(([key, nested]) => [key, sanitizeAuditValue(nested)])
  );
}

function auditValues(source: JsonRow, keys: string[]): AuditValues | undefined {
  const found = value(source, ...keys);
  return found && typeof found === 'object' && !Array.isArray(found)
    ? (sanitizeAuditValue(found) as AuditValues)
    : undefined;
}

function mapAccount(input: unknown): Account {
  const item = row(input);
  return {
    id: textValue(item, ['id']),
    name: textValue(item, ['name']),
    status: value(item, 'status') === 'inactive' ? 'inactive' : 'active',
    archivedAt: optionalText(item, ['archivedAt', 'archived_at']),
    archivedByUserId: optionalText(item, ['archivedByUserId', 'archivedBy', 'archived_by']),
    archiveReason: optionalText(item, ['archiveReason', 'archive_reason']),
    createdAt: textValue(item, ['createdAt', 'created_at']),
    updatedAt: textValue(item, ['updatedAt', 'updated_at']),
    version: numberValue(item, ['version'], 1)
  };
}

function mapUser(input: unknown): PersonUser {
  const item = row(input);
  return {
    id: textValue(item, ['id']),
    accountId: optionalText(item, ['accountId', 'account_id']),
    username: optionalText(item, ['username']),
    name: textValue(item, ['name']),
    role: value(item, 'role') === 'admin' ? 'admin' : 'user',
    status: value(item, 'status') === 'inactive' ? 'inactive' : 'active',
    archivedAt: optionalText(item, ['archivedAt', 'archived_at']),
    archivedByUserId: optionalText(item, ['archivedByUserId', 'archivedBy', 'archived_by']),
    archiveReason: optionalText(item, ['archiveReason', 'archive_reason']),
    createdAt: textValue(item, ['createdAt', 'created_at']),
    updatedAt: textValue(item, ['updatedAt', 'updated_at']),
    version: numberValue(item, ['version'], 1)
  };
}

function mapProduct(input: unknown): Product {
  const item = row(input);
  return {
    id: textValue(item, ['id']),
    name: textValue(item, ['name']),
    category: textValue(item, ['category'], 'General'),
    price: numberValue(item, ['price']),
    stockMin: numberValue(item, ['stockMin', 'stock_min']),
    lastCost: numberValue(item, ['lastCost', 'last_cost']),
    imageUrl: optionalText(item, ['imageUrl', 'image_url']),
    imageSourceUrl: optionalText(item, ['imageSourceUrl', 'image_source_url']),
    imageCredit: optionalText(item, ['imageCredit', 'image_credit']),
    status: value(item, 'status') === 'inactive' ? 'inactive' : 'active',
    archivedAt: optionalText(item, ['archivedAt', 'archived_at']),
    archivedByUserId: optionalText(item, ['archivedByUserId', 'archivedBy', 'archived_by']),
    archiveReason: optionalText(item, ['archiveReason', 'archive_reason']),
    createdAt: textValue(item, ['createdAt', 'created_at']),
    updatedAt: textValue(item, ['updatedAt', 'updated_at']),
    version: numberValue(item, ['version'], 1)
  };
}

function mapConsumption(input: unknown): Consumption {
  const item = row(input);
  const costStatus = value(item, 'costStatus', 'cost_status');
  return {
    id: textValue(item, ['id']),
    clientOperationId: textValue(item, ['clientOperationId', 'client_operation_id']),
    accountId: optionalText(item, ['accountId', 'account_id']),
    userId: textValue(item, ['userId', 'user_id']),
    deviceId: optionalText(item, ['deviceId', 'device_id']),
    status: value(item, 'status') === 'voided' ? 'voided' : 'confirmed',
    total: numberValue(item, ['total']),
    costTotal: numberValue(item, ['costTotal', 'cost_total']),
    pendingCostQuantity: numberValue(item, ['pendingCostQuantity', 'pending_cost_quantity']),
    costStatus: costStatus === 'final' ? 'final' : 'pending_inventory',
    createdAt: textValue(item, ['createdAt', 'created_at']),
    voidedAt: optionalText(item, ['voidedAt', 'voided_at']),
    voidedByUserId: optionalText(item, ['voidedByUserId', 'voidedBy', 'voided_by']),
    voidReason: optionalText(item, ['voidReason', 'void_reason']),
    requestId: optionalText(item, ['requestId', 'request_id'])
  };
}

function mapConsumptionItem(input: unknown): ConsumptionItem {
  const item = row(input);
  const costStatus = value(item, 'costStatus', 'cost_status');
  return {
    id: textValue(item, ['id']),
    consumptionId: textValue(item, ['consumptionId', 'consumption_id']),
    productId: textValue(item, ['productId', 'product_id']),
    productName: textValue(item, ['productName', 'product_name']),
    quantity: numberValue(item, ['quantity']),
    unitPrice: numberValue(item, ['unitPrice', 'unit_price']),
    total: numberValue(item, ['total']),
    unitCost: numberValue(item, ['unitCost', 'unit_cost']),
    costTotal: numberValue(item, ['costTotal', 'cost_total']),
    pendingCostQuantity: numberValue(item, ['pendingCostQuantity', 'pending_cost_quantity']),
    costStatus: costStatus === 'final' ? 'final' : 'pending_inventory',
    createdAt: textValue(item, ['createdAt', 'created_at'])
  };
}

function financialMovementType(input: unknown): FinancialMovementType {
  return input === 'adjustment' || input === 'account_transfer' || input === 'payment_reversal' || input === 'adjustment_reversal'
    ? input
    : 'payment';
}

function mapFinancialMovement(input: unknown): FinancialMovement {
  const item = row(input);
  const id = textValue(item, ['id']);
  return {
    id,
    accountId: optionalText(item, ['accountId', 'account_id']),
    scope: value(item, 'scope') === 'user' ? 'user' : 'account',
    userId: optionalText(item, ['userId', 'user_id']),
    paidByUserId: optionalText(item, ['paidByUserId', 'paid_by_user_id']),
    movementType: financialMovementType(value(item, 'movementType', 'movement_type', 'type')),
    amount: numberValue(item, ['amount']),
    fromAccountId: optionalText(item, ['fromAccountId', 'from_account_id']),
    toAccountId: optionalText(item, ['toAccountId', 'to_account_id']),
    note: optionalText(item, ['note']),
    reversedMovementId: optionalText(item, ['reversedMovementId', 'reversed_movement_id']),
    createdBy: optionalText(item, ['createdBy', 'created_by']),
    requestId: textValue(item, ['requestId', 'request_id'], id),
    unappliedAmount: numberValue(item, ['unappliedAmount', 'unapplied_amount']),
    createdAt: textValue(item, ['createdAt', 'created_at'])
  };
}

function mapPaymentApplication(input: unknown): PaymentApplication {
  const item = row(input);
  return {
    id: textValue(item, ['id']),
    financialMovementId: textValue(item, ['financialMovementId', 'financial_movement_id', 'paymentId', 'payment_id']),
    accountId: optionalText(item, ['accountId', 'account_id']),
    userId: textValue(item, ['userId', 'user_id']),
    consumptionId: textValue(item, ['consumptionId', 'consumption_id']),
    amount: numberValue(item, ['amount']),
    reversedApplicationId: optionalText(item, ['reversedApplicationId', 'reversed_application_id']),
    createdAt: textValue(item, ['createdAt', 'created_at'])
  };
}

function inventoryMovementType(input: unknown): InventoryMovementType {
  return input === 'consumption' || input === 'void_consumption' || input === 'adjustment' || input === 'adjustment_reversal'
    ? input
    : 'purchase';
}

function mapInventoryMovement(input: unknown): InventoryMovement {
  const item = row(input);
  const id = textValue(item, ['id']);
  return {
    id,
    productId: textValue(item, ['productId', 'product_id']),
    movementType: inventoryMovementType(value(item, 'movementType', 'movement_type', 'type')),
    quantityDelta: numberValue(item, ['quantityDelta', 'quantity_delta']),
    unitCost: numberValue(item, ['unitCost', 'unit_cost']),
    consumptionItemId: optionalText(item, ['consumptionItemId', 'consumption_item_id']),
    reversedMovementId: optionalText(item, ['reversedMovementId', 'reversed_movement_id']),
    note: optionalText(item, ['note']),
    createdBy: optionalText(item, ['createdBy', 'created_by']),
    requestId: textValue(item, ['requestId', 'request_id'], id),
    createdAt: textValue(item, ['createdAt', 'created_at'])
  };
}

function mapFifoAllocation(input: unknown): FifoCostAllocation {
  const item = row(input);
  return {
    id: textValue(item, ['id']),
    productId: textValue(item, ['productId', 'product_id']),
    consumptionItemId: optionalText(item, ['consumptionItemId', 'consumption_item_id']),
    targetMovementId: textValue(item, ['targetMovementId', 'target_movement_id']),
    sourceMovementId: textValue(item, ['sourceMovementId', 'source_movement_id']),
    quantity: numberValue(item, ['quantity']),
    unitCost: numberValue(item, ['unitCost', 'unit_cost']),
    totalCost: numberValue(item, ['totalCost', 'total_cost', 'costTotal', 'cost_total']),
    reversedAllocationId: optionalText(item, ['reversedAllocationId', 'reversed_allocation_id']),
    createdAt: textValue(item, ['createdAt', 'created_at'])
  };
}

export function mapAuditLogEntry(input: unknown): AuditLogEntry {
  const item = row(input);
  const id = textValue(item, ['id']);
  const changed = value(item, 'changedFields', 'changed_fields');
  return {
    id,
    requestId: textValue(item, ['requestId', 'request_id'], id),
    idempotencyKey: optionalText(item, ['idempotencyKey', 'idempotency_key']),
    actorUserId: optionalText(item, ['actorUserId', 'actor_user_id']),
    actorName: optionalText(item, ['actorName', 'actor_name']),
    action: (
      [
        'create',
        'update',
        'delete',
        'archive',
        'restore',
        'void',
        'reverse',
        'command',
        'login_failed',
        'login_rejected',
        'logout',
        'pin_changed'
      ] as const
    ).includes(value(item, 'action') as AuditLogEntry['action'])
      ? (value(item, 'action') as AuditLogEntry['action'])
      : 'create',
    entityType: textValue(item, ['entityType', 'entity_type']),
    recordId: optionalText(item, ['recordId', 'record_id']),
    beforeData: auditValues(item, ['beforeData', 'before_data']),
    afterData: auditValues(item, ['afterData', 'after_data']),
    changedFields: Array.isArray(changed)
      ? changed.map(String).filter((field) => !isSensitiveAuditKey(field))
      : [],
    reason: optionalText(item, ['reason']),
    deviceId: optionalText(item, ['deviceId', 'device_id']),
    metadata: auditValues(item, ['metadata']),
    createdAt: textValue(item, ['createdAt', 'created_at'])
  };
}

function mapProductStock(input: unknown): ProductStock {
  const item = row(input);
  const stock = numberValue(item, ['stock', 'stockQuantity', 'stock_quantity']);
  const stockMin = numberValue(item, ['stockMin', 'stock_min']);
  return {
    productId: textValue(item, ['productId', 'product_id']),
    stock,
    stockMin,
    isLow: value(item, 'isLow', 'is_low') === true || stock <= stockMin,
    lastCost: numberValue(item, ['lastCost', 'last_cost']),
    inventoryValue: numberValue(item, ['inventoryValue', 'inventory_value'])
  };
}

function mapConsumptionCost(input: unknown): ConsumptionCost {
  const item = row(input);
  const pending = numberValue(item, ['pendingCostQuantity', 'pending_cost_quantity', 'pendingQuantity', 'pending_quantity']);
  return {
    consumptionId: textValue(item, ['consumptionId', 'consumption_id']),
    costTotal: numberValue(item, ['costTotal', 'cost_total']),
    pendingCostQuantity: pending,
    costStatus: value(item, 'costStatus', 'cost_status') === 'final' && pending <= 0 ? 'final' : 'pending_inventory'
  };
}

function mapUserBalance(input: unknown): UserBalance {
  const item = row(input);
  return {
    userId: textValue(item, ['userId', 'user_id']),
    accountId: optionalText(item, ['accountId', 'account_id']),
    consumed: numberValue(item, ['consumed']),
    paid: numberValue(item, ['paid']),
    adjustments: numberValue(item, ['adjustments']),
    balance: numberValue(item, ['balance']),
    unappliedCredit: numberValue(item, ['unappliedCredit', 'unapplied_credit'])
  };
}

function mapAccountBalance(input: unknown, users: UserBalance[]): AccountBalance {
  const item = row(input);
  const accountId = textValue(item, ['accountId', 'account_id']);
  return {
    accountId,
    consumed: numberValue(item, ['consumed']),
    paid: numberValue(item, ['paid']),
    adjustments: numberValue(item, ['adjustments']),
    balance: numberValue(item, ['balance']),
    unappliedCredit: numberValue(item, ['unappliedCredit', 'unapplied_credit']),
    users: arrayValue(item, 'users').length > 0
      ? arrayValue(item, 'users').map(mapUserBalance)
      : users.filter((entry) => entry.accountId === accountId)
  };
}

function mapPaymentStatus(input: unknown): ConsumptionPaymentStatus {
  const item = row(input);
  const status = value(item, 'status', 'paymentStatus', 'payment_status');
  return {
    consumptionId: textValue(item, ['consumptionId', 'consumption_id']),
    userId: textValue(item, ['userId', 'user_id']),
    accountId: optionalText(item, ['accountId', 'account_id']),
    total: numberValue(item, ['total', 'totalDue', 'total_due']),
    paid: numberValue(item, ['paid', 'appliedAmount', 'applied_amount']),
    openAmount: numberValue(item, ['openAmount', 'open_amount']),
    status: status === 'paid' || status === 'partial' || status === 'voided' ? status : 'unpaid'
  };
}

export function mapAdminSnapshot(input: unknown): AdminSnapshot {
  const payload = row(Array.isArray(input) ? input[0] : input);
  const accounts = arrayValue(payload, 'accounts').map(mapAccount);
  const users = arrayValue(payload, 'users').map(mapUser);
  const products = arrayValue(payload, 'products').map(mapProduct);
  const consumptions = arrayValue(payload, 'consumptions').map(mapConsumption);
  const consumptionItems = arrayValue(payload, 'consumptionItems', 'consumption_items').map(mapConsumptionItem);
  const financialMovements = arrayValue(payload, 'financialMovements', 'financial_movements').map(mapFinancialMovement);
  const paymentApplications = arrayValue(payload, 'paymentApplications', 'payment_applications').map(mapPaymentApplication);
  const inventoryMovements = arrayValue(payload, 'inventoryMovements', 'inventory_movements').map(mapInventoryMovement);
  const fifoCostAllocations = arrayValue(payload, 'fifoCostAllocations', 'fifo_cost_allocations').map(mapFifoAllocation);

  const productStockRows = arrayValue(payload, 'productStocks', 'productStock', 'product_stock');
  const productStocks = productStockRows.length > 0
    ? productStockRows.map(mapProductStock)
    : calculateProductStocks(products, inventoryMovements);

  const costRows = arrayValue(payload, 'consumptionCosts', 'consumption_costs');
  const consumptionCosts = costRows.length > 0
    ? costRows.map(mapConsumptionCost)
    : calculateConsumptionCosts({ consumptions, items: consumptionItems, allocations: fifoCostAllocations });

  const userBalanceRows = arrayValue(payload, 'userBalances', 'user_balances');
  const userBalances = userBalanceRows.length > 0
    ? userBalanceRows.map(mapUserBalance)
    : calculateUserBalances({ users, consumptions, financialMovements, applications: paymentApplications });

  const accountBalanceRows = arrayValue(payload, 'accountBalances', 'account_balances');
  const accountBalances = accountBalanceRows.length > 0
    ? accountBalanceRows.map((entry) => mapAccountBalance(entry, userBalances))
    : accounts.map((account) => calculateAccountBalance({
        account,
        users,
        consumptions,
        financialMovements,
        applications: paymentApplications
      }));

  const paymentStatusRows = arrayValue(
    payload,
    'consumptionPaymentStatuses',
    'consumptionPaymentStatus',
    'consumption_payment_status'
  );
  const consumptionPaymentStatuses = paymentStatusRows.length > 0
    ? paymentStatusRows.map(mapPaymentStatus)
    : calculateConsumptionPaymentStatuses({ consumptions, applications: paymentApplications });

  return {
    accounts,
    users,
    products,
    consumptions,
    consumptionItems,
    financialMovements,
    paymentApplications,
    inventoryMovements,
    fifoCostAllocations,
    auditLog: arrayValue(payload, 'auditLog', 'audit_log').map(mapAuditLogEntry),
    productStocks,
    consumptionCosts,
    userBalances,
    accountBalances,
    consumptionPaymentStatuses,
    catalogVersion: numberValue(payload, ['catalogVersion', 'catalog_version']),
    generatedAt: textValue(payload, ['generatedAt', 'generated_at'], new Date().toISOString())
  };
}

function requireAdminOnline(session?: AppSession): AppSession {
  if (!isSyncConfigured()) throw new Error('Supabase no esta configurado.');
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('La administracion requiere conexion a internet.');
  }
  if (!session?.token || session.role !== 'admin') throw new Error('Sesion de administrador requerida.');
  return session;
}

async function adminCommand<T = JsonRow>(
  session: AppSession | undefined,
  command: string,
  payload: JsonRow,
  idempotencyKey?: string
): Promise<T> {
  const activeSession = requireAdminOnline(session);
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');

  const { data, error } = await supabase.rpc('admin_command', {
    p_session_token: activeSession.token,
    p_idempotency_key: idempotencyKey ?? crypto.randomUUID(),
    p_command: command,
    p_payload: { ...payload, deviceId: activeSession.deviceId }
  });

  if (error) throw new Error(error.message);
  return (data ?? {}) as T;
}

export async function loadAdminSnapshot(session: AppSession | undefined): Promise<AdminSnapshot> {
  const activeSession = requireAdminOnline(session);
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');
  const { data, error } = await supabase.rpc('admin_get_snapshot', { p_session_token: activeSession.token });
  if (error) throw new Error(error.message);
  return mapAdminSnapshot(data);
}

export async function loadAuditLog(session: AppSession | undefined, filters: AuditLogFilters = {}): Promise<AuditLogPage> {
  const activeSession = requireAdminOnline(session);
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');
  const { data, error } = await supabase.rpc('admin_get_audit_log', {
    p_session_token: activeSession.token,
    p_page: Math.max(1, filters.page ?? 1),
    p_page_size: Math.min(200, Math.max(1, filters.limit ?? 50)),
    p_entity_type: filters.entityType || null,
    p_action: filters.action || null,
    p_actor_user_id: filters.actorUserId || null,
    p_search: filters.search?.trim() || null,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null
  });
  if (error) throw new Error(error.message);
  const payload = row(Array.isArray(data) ? data[0] : data);
  const entries = arrayValue(payload, 'items', 'entries', 'auditLog', 'audit_log').map(mapAuditLogEntry);
  return {
    entries,
    page: numberValue(payload, ['page'], filters.page ?? 1),
    pageSize: numberValue(payload, ['pageSize', 'page_size'], filters.limit ?? 50),
    total: numberValue(payload, ['total'], entries.length)
  };
}

export async function loadAllAuditLog(
  session: AppSession | undefined,
  filters: Omit<AuditLogFilters, 'page' | 'limit'> = {}
): Promise<AuditLogEntry[]> {
  const entries: AuditLogEntry[] = [];
  let page = 1;
  let total = 0;
  let pageSize = 200;

  do {
    const result = await loadAuditLog(session, { ...filters, page, limit: 200 });
    entries.push(...result.entries);
    total = result.total;
    pageSize = Math.max(1, result.pageSize);
    page += 1;
  } while ((page - 1) * pageSize < total);

  return entries;
}

export async function createAccount(
  input: { name: string; userIds?: string[] },
  session?: AppSession,
  idempotencyKey?: string
): Promise<{ id: string; assignedUserIds?: string[] }> {
  return adminCommand(session, 'create_account', input, idempotencyKey);
}

export async function updateAccount(account: Account & { reason?: string }, session?: AppSession, idempotencyKey?: string): Promise<void> {
  await adminCommand(session, 'update_account', account as unknown as JsonRow, idempotencyKey);
}

export async function setAccountStatus(accountId: string, status: 'active' | 'inactive', reason: string, session?: AppSession, idempotencyKey?: string): Promise<void> {
  await adminCommand(session, status === 'inactive' ? 'archive_account' : 'restore_account', {
    id: accountId,
    reason: reason.trim() || (status === 'inactive' ? 'Archivado por administrador' : 'Restaurado por administrador')
  }, idempotencyKey);
}

export async function createUser(
  input: { accountId?: string; name: string; username?: string; pin: string; role?: 'admin' | 'user' },
  session?: AppSession,
  idempotencyKey?: string
): Promise<{ id: string }> {
  return adminCommand(session, 'create_user', input, idempotencyKey);
}

export async function updateUser(input: PersonUser & { newPin?: string; reason?: string }, session?: AppSession, idempotencyKey?: string): Promise<void> {
  await adminCommand(session, 'update_user', input as unknown as JsonRow, idempotencyKey);
}

export async function setUserStatus(userId: string, status: 'active' | 'inactive', reason: string, session?: AppSession, idempotencyKey?: string): Promise<void> {
  await adminCommand(session, status === 'inactive' ? 'archive_user' : 'restore_user', {
    id: userId,
    reason: reason.trim() || (status === 'inactive' ? 'Archivado por administrador' : 'Restaurado por administrador')
  }, idempotencyKey);
}

export async function createProduct(
  input: {
    name: string;
    category: string;
    price: number;
    stockMin: number;
    lastCost?: number;
    imageUrl?: string;
    imageSourceUrl?: string;
    imageCredit?: string;
  },
  session?: AppSession,
  idempotencyKey?: string
): Promise<{ id: string }> {
  return adminCommand(session, 'create_product', input, idempotencyKey);
}

export async function updateProduct(product: Product & { reason?: string }, session?: AppSession, idempotencyKey?: string): Promise<void> {
  await adminCommand(session, 'update_product', product as unknown as JsonRow, idempotencyKey);
}

export async function setProductStatus(productId: string, status: 'active' | 'inactive', reason: string, session?: AppSession, idempotencyKey?: string): Promise<void> {
  await adminCommand(session, status === 'inactive' ? 'archive_product' : 'restore_product', {
    id: productId,
    reason: reason.trim() || (status === 'inactive' ? 'Archivado por administrador' : 'Restaurado por administrador')
  }, idempotencyKey);
}

export async function createPurchase(
  input: { productId: string; quantity: number; unitCost: number; note?: string },
  session?: AppSession,
  idempotencyKey?: string
): Promise<{ id: string }> {
  return adminCommand(session, 'create_purchase', input, idempotencyKey);
}

export async function createPayment(
  input: { accountId?: string; targetType: 'account' | 'user'; userId?: string; paidByUserId?: string; amount: number; note?: string },
  session?: AppSession,
  idempotencyKey?: string
): Promise<{ id: string }> {
  return adminCommand(session, 'create_payment', input, idempotencyKey);
}

export async function reverseFinancialMovement(movementId: string, reason: string, session?: AppSession, idempotencyKey?: string): Promise<void> {
  if (!reason.trim()) throw new Error('El motivo de la reversión es obligatorio.');
  await adminCommand(session, 'reverse_financial_movement', { movementId, reason: reason.trim() }, idempotencyKey);
}

export async function createBalanceAdjustment(
  input: { accountId?: string; scope: 'account' | 'user'; userId?: string; amount: number; note: string },
  session?: AppSession,
  idempotencyKey?: string
): Promise<{ id: string }> {
  return adminCommand(session, 'create_adjustment', input, idempotencyKey);
}

export async function adjustInventory(
  input: { productId: string; quantityDelta: number; unitCost?: number; note: string },
  session?: AppSession,
  idempotencyKey?: string
): Promise<void> {
  await adminCommand(session, 'adjust_inventory', input, idempotencyKey);
}

export async function applyBulkProductOperation(
  mode: 'purchase' | 'inventory' | 'prices',
  items: JsonRow[],
  session?: AppSession,
  idempotencyKey?: string
): Promise<{ count: number; items?: JsonRow[] }> {
  if (items.length === 0) throw new Error('Ingresa al menos un cambio para aplicar.');
  return adminCommand(session, 'bulk_products', { mode, items }, idempotencyKey);
}

export async function voidConsumption(consumptionId: string, reason: string, session?: AppSession, idempotencyKey?: string): Promise<void> {
  if (!reason.trim()) throw new Error('El motivo de anulación es obligatorio.');
  await adminCommand(session, 'void_consumption', { consumptionId, reason: reason.trim() }, idempotencyKey);
}

export async function independizeUser(
  userId: string,
  newAccountName: string,
  session?: AppSession,
  idempotencyKey?: string,
  expectedVersion?: number
): Promise<{ id: string }> {
  return adminCommand(session, 'independize_user', { userId, newAccountName, expectedVersion }, idempotencyKey);
}

export async function mergeAccounts(sourceAccountId: string, targetAccountId: string, session?: AppSession, idempotencyKey?: string): Promise<void> {
  await adminCommand(session, 'merge_accounts', { sourceAccountId, targetAccountId }, idempotencyKey);
}

export async function assignUserToAccount(userId: string, accountId: string, session?: AppSession, idempotencyKey?: string, expectedVersion?: number): Promise<void> {
  await adminCommand(session, 'assign_user_to_account', { userId, accountId, expectedVersion }, idempotencyKey);
}

export async function removeUserFromAccount(userId: string, session?: AppSession, idempotencyKey?: string, expectedVersion?: number): Promise<void> {
  await adminCommand(session, 'remove_user_from_account', { userId, expectedVersion }, idempotencyKey);
}

export async function reverseInventoryMovement(movementId: string, reason: string, session?: AppSession, idempotencyKey?: string): Promise<void> {
  if (!reason.trim()) throw new Error('El motivo de la reversión es obligatorio.');
  await adminCommand(session, 'reverse_inventory_movement', { movementId, reason: reason.trim() }, idempotencyKey);
}

export async function recalculateFifo(input: { productId?: string } = {}, session?: AppSession, idempotencyKey?: string): Promise<void> {
  await adminCommand(session, 'recalculate_fifo', input, idempotencyKey);
}
