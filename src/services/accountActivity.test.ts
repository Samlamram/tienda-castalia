import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSession } from '../domain/types';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  configured: true
}));

vi.mock('./sync', () => ({
  getSupabaseClient: () => ({ rpc: mocks.rpc }),
  isSyncConfigured: () => mocks.configured
}));

import { loadUserAccountActivity } from './accountActivity';

const session: AppSession = {
  key: 'current',
  token: 'user-token',
  role: 'user',
  deviceMode: 'personal',
  userId: 'user-1',
  userName: 'Ana',
  accountId: 'account-1',
  accountName: 'Familia',
  balance: 5000,
  expiresAt: '2099-01-01T00:00:00.000Z',
  deviceId: 'device-1',
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T12:00:00.000Z'
};

describe('loadUserAccountActivity', () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.rpc.mockReset();
  });

  it('solicita actividad limitada y mapea estados financieros del usuario', async () => {
    mocks.rpc.mockResolvedValue({
      error: null,
      data: {
        accounts: [{ id: 'account-1', name: 'Familia', status: 'active' }],
        users: [{ id: 'user-1', accountId: 'account-1', name: 'Ana', role: 'user', status: 'active' }],
        consumptions: [{
          id: 'consumption-1',
          clientOperationId: 'operation-1',
          accountId: 'account-1',
          userId: 'user-1',
          status: 'confirmed',
          total: 12000,
          createdAt: '2026-07-18T12:00:00.000Z'
        }],
        consumptionItems: [{
          id: 'item-1',
          consumptionId: 'consumption-1',
          productId: 'product-1',
          productName: 'Agua',
          quantity: 2,
          unitPrice: 6000,
          total: 12000,
          createdAt: '2026-07-18T12:00:00.000Z'
        }],
        financialMovements: [{
          id: 'payment-1',
          movementType: 'payment',
          accountId: 'account-1',
          scope: 'user',
          userId: 'user-1',
          paidByUserId: 'user-1',
          amount: 7000,
          requestId: 'request-1',
          createdAt: '2026-07-18T13:00:00.000Z'
        }],
        paymentApplications: [{
          id: 'application-1',
          financialMovementId: 'payment-1',
          consumptionId: 'consumption-1',
          accountId: 'account-1',
          userId: 'user-1',
          amount: 7000,
          createdAt: '2026-07-18T13:00:00.000Z'
        }],
        userBalances: [{
          userId: 'user-1',
          accountId: 'account-1',
          consumed: 12000,
          paid: 7000,
          adjustments: 0,
          balance: 5000,
          unappliedCredit: 0
        }],
        accountBalances: [{
          accountId: 'account-1',
          consumed: 12000,
          paid: 7000,
          adjustments: 0,
          balance: 5000,
          unappliedCredit: 0
        }],
        consumptionPaymentStatuses: [{
          consumptionId: 'consumption-1',
          userId: 'user-1',
          accountId: 'account-1',
          total: 12000,
          paid: 7000,
          openAmount: 5000,
          status: 'partial'
        }],
        generatedAt: '2026-07-18T14:00:00.000Z'
      }
    });

    const result = await loadUserAccountActivity(session);

    expect(mocks.rpc).toHaveBeenCalledWith('get_user_account_activity', {
      p_session_token: 'user-token',
      p_limit: 50
    });
    expect(result.consumptions).toHaveLength(1);
    expect(result.consumptionItems[0]?.productName).toBe('Agua');
    expect(result.consumptionPaymentStatuses[0]).toMatchObject({ status: 'partial', openAmount: 5000 });
    expect(result.accountBalances[0]?.balance).toBe(5000);
  });

  it('propaga el error del RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Sesion invalida o expirada.' } });

    await expect(loadUserAccountActivity(session)).rejects.toThrow('Sesion invalida o expirada.');
  });
});
