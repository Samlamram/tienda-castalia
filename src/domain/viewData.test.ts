import { describe, expect, it } from 'vitest';
import type { AdminSnapshot, AppSession, CatalogProduct, PendingConsumption } from './types';
import { cachedUserViewData, EMPTY_ADMIN_SNAPSHOT } from './viewData';

const timestamp = '2026-07-18T12:00:00.000Z';

const session: AppSession = {
  key: 'current',
  token: 'token-1',
  role: 'user',
  deviceMode: 'personal',
  userId: 'user-1',
  userName: 'Ana',
  accountId: 'account-1',
  accountName: 'Familia',
  balance: 999,
  expiresAt: '2099-01-01T00:00:00.000Z',
  deviceId: 'device-1',
  createdAt: timestamp,
  updatedAt: timestamp
};

const product: CatalogProduct = {
  id: 'product-1',
  name: 'Agua',
  category: 'Bebidas',
  price: 6000,
  status: 'active',
  version: 1,
  updatedAt: timestamp
};

const pending: PendingConsumption = {
  id: 'pending-1',
  clientOperationId: 'pending-1',
  sessionUserId: 'user-1',
  accountId: 'account-1',
  deviceId: 'device-1',
  catalogVersion: 1,
  items: [{ productId: 'product-1', quantity: 1 }],
  status: 'pending',
  attempts: 0,
  createdAt: timestamp,
  updatedAt: timestamp
};

const activity: AdminSnapshot = {
  ...EMPTY_ADMIN_SNAPSHOT,
  accounts: [{
    id: 'account-1',
    name: 'Familia',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1
  }],
  users: [{
    id: 'user-1',
    accountId: 'account-1',
    name: 'Ana',
    role: 'user',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1
  }],
  consumptions: [{
    id: 'consumption-1',
    clientOperationId: 'operation-1',
    accountId: 'account-1',
    userId: 'user-1',
    status: 'confirmed',
    total: 12000,
    createdAt: timestamp
  }],
  consumptionItems: [{
    id: 'item-1',
    consumptionId: 'consumption-1',
    productId: 'product-1',
    productName: 'Agua',
    quantity: 2,
    unitPrice: 6000,
    total: 12000,
    createdAt: timestamp
  }],
  financialMovements: [{
    id: 'payment-1',
    accountId: 'account-1',
    scope: 'user',
    userId: 'user-1',
    paidByUserId: 'user-1',
    movementType: 'payment',
    amount: 12000,
    requestId: 'request-1',
    createdAt: timestamp
  }],
  paymentApplications: [{
    id: 'application-1',
    financialMovementId: 'payment-1',
    accountId: 'account-1',
    userId: 'user-1',
    consumptionId: 'consumption-1',
    amount: 12000,
    createdAt: timestamp
  }],
  userBalances: [{
    userId: 'user-1',
    accountId: 'account-1',
    consumed: 12000,
    paid: 12000,
    adjustments: 0,
    balance: 0,
    unappliedCredit: 0
  }],
  accountBalances: [{
    accountId: 'account-1',
    consumed: 12000,
    paid: 12000,
    adjustments: 0,
    balance: 0,
    unappliedCredit: 0,
    users: []
  }],
  consumptionPaymentStatuses: [{
    consumptionId: 'consumption-1',
    userId: 'user-1',
    accountId: 'account-1',
    total: 12000,
    paid: 12000,
    openAmount: 0,
    status: 'paid'
  }],
  generatedAt: timestamp
};

describe('cachedUserViewData', () => {
  it('combina catalogo y cola local con la actividad oficial de la cuenta', () => {
    const result = cachedUserViewData({
      session,
      products: [product],
      pendingConsumptions: [pending],
      settings: [],
      activity
    });

    expect(result.products[0]?.name).toBe('Agua');
    expect(result.consumptions[0]?.id).toBe('consumption-1');
    expect(result.payments[0]).toMatchObject({ id: 'payment-1', amount: 12000 });
    expect(result.consumptionPaymentStatuses[0]?.status).toBe('paid');
    expect(result.accountBalances[0]?.balance).toBe(0);
    expect(result.pendingConsumptions[0]?.status).toBe('pending');
  });
});
