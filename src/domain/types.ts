export type EntityStatus = 'active' | 'inactive';
export type ConsumptionStatus = 'confirmed' | 'voided';
export type CostStatus = 'final' | 'pending_inventory';
export type AppRole = 'admin' | 'user';
export type DeviceMode = 'personal' | 'shared';
export type PendingConsumptionStatus =
  | 'pending'
  | 'sending'
  | 'confirmed'
  | 'failed'
  | 'needs_review';
export type FinancialMovementType =
  | 'payment'
  | 'adjustment'
  | 'account_transfer'
  | 'payment_reversal'
  | 'adjustment_reversal';
export type FinancialMovementScope = 'account' | 'user';
export type InventoryMovementType =
  | 'purchase'
  | 'consumption'
  | 'void_consumption'
  | 'adjustment'
  | 'adjustment_reversal';
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'archive'
  | 'restore'
  | 'void'
  | 'reverse'
  | 'command'
  | 'login_failed'
  | 'login_rejected'
  | 'logout'
  | 'pin_changed';
export type ConsumptionPaymentState = 'unpaid' | 'partial' | 'paid' | 'voided';
export type StoreFinanceEventType =
  | 'capital_contribution'
  | 'expense'
  | 'owner_withdrawal'
  | 'capital_contribution_reversal'
  | 'expense_reversal'
  | 'owner_withdrawal_reversal';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type AuditValues = Record<string, JsonValue>;

interface ArchivedEntity {
  status: EntityStatus;
  archivedAt?: string;
  archivedByUserId?: string;
  archiveReason?: string;
}

export interface Account extends ArchivedEntity {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Public user data. PIN hashes and salts must never be returned to the client. */
export interface PersonUser extends ArchivedEntity {
  id: string;
  accountId?: string;
  name: string;
  username?: string;
  role: AppRole;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Product extends ArchivedEntity {
  id: string;
  name: string;
  category: string;
  price: number;
  stockMin: number;
  imageUrl?: string;
  imageSourceUrl?: string;
  imageCredit?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Derived by the server from inventory entries; it is not stored on products. */
  lastCost?: number;
}

export interface Consumption {
  id: string;
  accountId?: string;
  userId: string;
  clientOperationId: string;
  deviceId?: string;
  status: ConsumptionStatus;
  total: number;
  createdAt: string;
  voidedAt?: string;
  voidedByUserId?: string;
  voidReason?: string;
  requestId?: string;
  /** Values projected by consumption_costs. */
  costTotal?: number;
  pendingCostQuantity?: number;
  costStatus?: CostStatus;
}

export interface ConsumptionItem {
  id: string;
  consumptionId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  createdAt: string;
  /** Values projected by consumption_costs. */
  unitCost?: number;
  costTotal?: number;
  pendingCostQuantity?: number;
  costStatus?: CostStatus;
}

/**
 * Immutable financial entry. Payment amounts reduce debt; adjustment amounts are
 * signed debt changes. A reversal is another entry linked through reversalOfId.
 */
export interface FinancialMovement {
  id: string;
  accountId?: string;
  scope: FinancialMovementScope;
  userId?: string;
  paidByUserId?: string;
  movementType: FinancialMovementType;
  amount: number;
  fromAccountId?: string;
  toAccountId?: string;
  note?: string;
  reversedMovementId?: string;
  createdBy?: string;
  requestId: string;
  createdAt: string;
  /** Derived as payment amount minus its applications. */
  unappliedAmount?: number;
}

/** A signed application of a payment to one complete consumption. */
export interface PaymentApplication {
  id: string;
  financialMovementId: string;
  accountId?: string;
  userId: string;
  consumptionId: string;
  amount: number;
  reversedApplicationId?: string;
  createdAt: string;
}

/** Immutable stock entry. Stock is always the sum of quantityDelta. */
export interface InventoryMovement {
  id: string;
  productId: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  unitCost?: number;
  consumptionItemId?: string;
  reversedMovementId?: string;
  note?: string;
  createdBy?: string;
  requestId: string;
  createdAt: string;
}

/** Immutable cash event owned by the store rather than by a customer account. */
export interface StoreFinanceEvent {
  id: string;
  eventType: StoreFinanceEventType;
  amount: number;
  beneficiary?: string;
  note: string;
  reversedEventId?: string;
  createdBy?: string;
  requestId: string;
  createdAt: string;
}

/** FIFO link between a sale item and the inventory entry that supplied its cost. */
export interface FifoCostAllocation {
  id: string;
  productId: string;
  consumptionItemId?: string;
  targetMovementId: string;
  sourceMovementId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  reversedAllocationId?: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  requestId: string;
  idempotencyKey?: string;
  actorUserId?: string;
  actorName?: string;
  action: AuditAction;
  entityType: string;
  recordId?: string;
  beforeData?: AuditValues;
  afterData?: AuditValues;
  changedFields: string[];
  reason?: string;
  deviceId?: string;
  metadata?: AuditValues;
  createdAt: string;
}

export interface Setting {
  key: string;
  value: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface AppSession {
  key: 'current';
  token: string;
  role: AppRole;
  deviceMode: DeviceMode;
  userId: string;
  userName: string;
  accountId?: string;
  accountName?: string;
  balance?: number;
  expiresAt: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
}

/** Minimal server catalog cached for user purchases while offline. */
export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  imageUrl?: string;
  imageSourceUrl?: string;
  imageCredit?: string;
  status: EntityStatus;
  version: number;
  updatedAt: string;
}

/** Durable outbox. clientOperationId is also the server idempotency key. */
export interface PendingConsumption {
  id: string;
  clientOperationId: string;
  sessionUserId: string;
  accountId?: string;
  deviceId: string;
  catalogVersion: number;
  items: CartItem[];
  status: PendingConsumptionStatus;
  attempts: number;
  error?: string;
  serverConsumptionId?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}

export interface UserBalance {
  userId: string;
  accountId?: string;
  consumed: number;
  paid: number;
  adjustments: number;
  balance: number;
  unappliedCredit: number;
}

export interface AccountBalance {
  accountId: string;
  consumed: number;
  paid: number;
  adjustments: number;
  balance: number;
  unappliedCredit: number;
  users: UserBalance[];
}

export interface ProductStock {
  productId: string;
  stock: number;
  stockMin: number;
  isLow: boolean;
  lastCost?: number;
  inventoryValue?: number;
}

export interface ConsumptionCost {
  consumptionId: string;
  costTotal: number;
  pendingCostQuantity: number;
  costStatus: CostStatus;
}

export interface ConsumptionPaymentStatus {
  consumptionId: string;
  userId: string;
  accountId?: string;
  total: number;
  paid: number;
  openAmount: number;
  status: ConsumptionPaymentState;
}

/** Complete, in-memory administrative response. It is never persisted in IndexedDB. */
export interface AdminSnapshot {
  accounts: Account[];
  users: PersonUser[];
  products: Product[];
  consumptions: Consumption[];
  consumptionItems: ConsumptionItem[];
  financialMovements: FinancialMovement[];
  paymentApplications: PaymentApplication[];
  inventoryMovements: InventoryMovement[];
  financeEvents: StoreFinanceEvent[];
  fifoCostAllocations: FifoCostAllocation[];
  auditLog: AuditLogEntry[];
  productStocks: ProductStock[];
  consumptionCosts: ConsumptionCost[];
  userBalances: UserBalance[];
  accountBalances: AccountBalance[];
  consumptionPaymentStatuses: ConsumptionPaymentStatus[];
  catalogVersion: number;
  generatedAt: string;
}

/** Read-only projections used by the existing UI; they are not database tables. */
export interface PaymentView {
  id: string;
  accountId?: string;
  targetType: FinancialMovementScope;
  userId?: string;
  paidByUserId?: string;
  amount: number;
  unappliedAmount: number;
  note?: string;
  reversedMovementId?: string;
  createdAt: string;
}

export interface BalanceAdjustmentView {
  id: string;
  accountId?: string;
  scope: FinancialMovementScope;
  userId?: string;
  movementType: 'adjustment' | 'adjustment_reversal';
  amount: number;
  note: string;
  reversalOfId?: string;
  reversedByMovementId?: string;
  createdAt: string;
}

export interface PurchaseView {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  note?: string;
  createdAt: string;
}

/** Shared view contract for the online admin and the cached user catalog. */
export interface TiendaViewData {
  accounts: Account[];
  users: PersonUser[];
  products: Product[];
  consumptions: Consumption[];
  items: ConsumptionItem[];
  financialMovements: FinancialMovement[];
  payments: PaymentView[];
  applications: PaymentApplication[];
  purchases: PurchaseView[];
  movements: InventoryMovement[];
  financeEvents: StoreFinanceEvent[];
  adjustments: BalanceAdjustmentView[];
  fifoCostAllocations: FifoCostAllocation[];
  auditLog: AuditLogEntry[];
  pendingSync: number;
  pendingConsumptions: PendingConsumption[];
  settings: Setting[];
  accountBalances: AccountBalance[];
  userBalances: UserBalance[];
  productStocks: ProductStock[];
  consumptionCosts: ConsumptionCost[];
  consumptionPaymentStatuses: ConsumptionPaymentStatus[];
}
