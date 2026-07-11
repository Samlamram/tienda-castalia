export type EntityStatus = 'active' | 'inactive';
export type ConsumptionStatus = 'confirmed' | 'voided';
export type CostStatus = 'final' | 'pending_recalc';
export type PaymentTarget = 'account' | 'user';
export type SyncStatus = 'pending' | 'synced' | 'failed';
export type AdjustmentScope = 'account' | 'user';
export type AppRole = 'admin' | 'user';
export type DeviceMode = 'personal' | 'shared';
export type PendingConsumptionStatus = 'pending' | 'sending' | 'confirmed' | 'failed' | 'needs_review';

export interface Account {
  id: string;
  name: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface PersonUser {
  id: string;
  accountId: string;
  name: string;
  pinHash: string;
  username?: string;
  role?: AppRole;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stockMin: number;
  lastCost: number;
  imageUrl?: string;
  imageSourceUrl?: string;
  imageCredit?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface Consumption {
  id: string;
  accountId: string;
  userId: string;
  status: ConsumptionStatus;
  total: number;
  costTotal: number;
  costStatus: CostStatus;
  createdAt: string;
  voidedAt?: string;
  voidReason?: string;
}

export interface ConsumptionItem {
  id: string;
  consumptionId: string;
  accountId: string;
  userId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  unitCost: number;
  costTotal: number;
  pendingCostQuantity: number;
  costStatus: CostStatus;
  createdAt: string;
}

export interface Payment {
  id: string;
  accountId: string;
  targetType: PaymentTarget;
  userId?: string;
  amount: number;
  unappliedAmount: number;
  note?: string;
  createdAt: string;
}

export interface PaymentApplication {
  id: string;
  paymentId: string;
  accountId: string;
  userId: string;
  consumptionItemId: string;
  amount: number;
  createdAt: string;
}

export interface Purchase {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  note?: string;
  createdAt: string;
}

export interface InventoryLot {
  id: string;
  productId: string;
  purchaseId: string;
  quantity: number;
  remainingQuantity: number;
  unitCost: number;
  createdAt: string;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  type: 'purchase' | 'consumption' | 'void_consumption' | 'adjustment' | 'cost_recalc';
  quantityDelta: number;
  unitCost?: number;
  referenceId?: string;
  note?: string;
  createdAt: string;
}

export interface BalanceAdjustment {
  id: string;
  accountId: string;
  scope: AdjustmentScope;
  userId?: string;
  amount: number;
  note: string;
  createdAt: string;
}

export interface AccountTransfer {
  id: string;
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  movedBalance: number;
  note: string;
  createdAt: string;
}

export interface SyncOperation {
  id: string;
  entity: string;
  entityId: string;
  action: 'upsert' | 'delete';
  payload: unknown;
  status: SyncStatus;
  attempts: number;
  error?: string;
  createdAt: string;
  syncedAt?: string;
}

export interface ExportBatch {
  id: string;
  sheetId: string;
  dateFrom: string;
  dateTo: string;
  rowsHash: string;
  status: SyncStatus;
  error?: string;
  createdAt: string;
  exportedAt?: string;
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
  accountId: string;
  consumed: number;
  paid: number;
  adjustments: number;
  balance: number;
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
}
