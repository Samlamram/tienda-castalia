import Dexie, { type EntityTable } from 'dexie';
import type {
  Account,
  AccountTransfer,
  AppSession,
  BalanceAdjustment,
  CatalogProduct,
  Consumption,
  ConsumptionItem,
  ExportBatch,
  InventoryLot,
  InventoryMovement,
  Payment,
  PaymentApplication,
  PendingConsumption,
  PersonUser,
  Product,
  Purchase,
  Setting,
  SyncOperation
} from '../domain/types';

export class TiendaDatabase extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  users!: EntityTable<PersonUser, 'id'>;
  products!: EntityTable<Product, 'id'>;
  consumptions!: EntityTable<Consumption, 'id'>;
  consumptionItems!: EntityTable<ConsumptionItem, 'id'>;
  payments!: EntityTable<Payment, 'id'>;
  paymentApplications!: EntityTable<PaymentApplication, 'id'>;
  purchases!: EntityTable<Purchase, 'id'>;
  inventoryLots!: EntityTable<InventoryLot, 'id'>;
  inventoryMovements!: EntityTable<InventoryMovement, 'id'>;
  adjustments!: EntityTable<BalanceAdjustment, 'id'>;
  accountTransfers!: EntityTable<AccountTransfer, 'id'>;
  syncOperations!: EntityTable<SyncOperation, 'id'>;
  exportBatches!: EntityTable<ExportBatch, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  appSessions!: EntityTable<AppSession, 'key'>;
  catalogProducts!: EntityTable<CatalogProduct, 'id'>;
  pendingConsumptions!: EntityTable<PendingConsumption, 'id'>;

  constructor() {
    super('app_tienda_v1');
    this.version(1).stores({
      accounts: 'id, status, name, updatedAt',
      users: 'id, accountId, status, name, updatedAt',
      products: 'id, status, category, name, updatedAt',
      consumptions: 'id, accountId, userId, status, createdAt, costStatus',
      consumptionItems:
        'id, consumptionId, accountId, userId, productId, createdAt, costStatus, pendingCostQuantity',
      payments: 'id, accountId, userId, targetType, createdAt',
      paymentApplications: 'id, paymentId, accountId, userId, consumptionItemId, createdAt',
      purchases: 'id, productId, createdAt',
      inventoryLots: 'id, productId, purchaseId, remainingQuantity, createdAt',
      inventoryMovements: 'id, productId, type, referenceId, createdAt',
      adjustments: 'id, accountId, userId, scope, createdAt',
      accountTransfers: 'id, userId, fromAccountId, toAccountId, createdAt',
      syncOperations: 'id, entity, entityId, status, createdAt',
      exportBatches: 'id, sheetId, dateFrom, dateTo, rowsHash, status, createdAt',
      settings: 'key'
    });
    this.version(2).stores({
      appSessions: 'key, role, userId, expiresAt, updatedAt',
      catalogProducts: 'id, status, category, name, version, updatedAt',
      pendingConsumptions: 'id, clientOperationId, sessionUserId, accountId, status, createdAt, updatedAt'
    });
  }
}

export const db = new TiendaDatabase();
