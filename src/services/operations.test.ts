import { describe, expect, it } from 'vitest';
import {
  calculateAccountBalance,
  calculateConsumptionCosts,
  calculateConsumptionPaymentStatuses
} from '../domain/ledger';
import type {
  Account,
  Consumption,
  ConsumptionItem,
  FifoCostAllocation,
  FinancialMovement,
  PaymentApplication
} from '../domain/types';

const createdAt = '2026-07-14T12:00:00.000Z';

const account: Account = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Familia',
  status: 'active',
  createdAt,
  updatedAt: createdAt,
  version: 1
};

const consumptions: Consumption[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    clientOperationId: '00000000-0000-4000-8000-000000000201',
    accountId: account.id,
    userId: '00000000-0000-4000-8000-000000000002',
    status: 'confirmed',
    total: 100,
    createdAt: '2026-07-14T12:00:00.000Z'
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    clientOperationId: '00000000-0000-4000-8000-000000000202',
    accountId: account.id,
    userId: '00000000-0000-4000-8000-000000000002',
    status: 'confirmed',
    total: 80,
    createdAt: '2026-07-14T12:01:00.000Z'
  }
];

const payment: FinancialMovement = {
  id: '00000000-0000-4000-8000-000000000301',
  accountId: account.id,
  scope: 'user',
  userId: '00000000-0000-4000-8000-000000000002',
  paidByUserId: '00000000-0000-4000-8000-000000000002',
  movementType: 'payment',
  amount: 150,
  requestId: '00000000-0000-4000-8000-000000000401',
  createdAt: '2026-07-14T13:00:00.000Z'
};

const paymentApplications: PaymentApplication[] = [
  {
    id: '00000000-0000-4000-8000-000000000501',
    financialMovementId: payment.id,
    accountId: account.id,
    userId: payment.userId!,
    consumptionId: consumptions[0].id,
    amount: 100,
    createdAt: payment.createdAt
  },
  {
    id: '00000000-0000-4000-8000-000000000502',
    financialMovementId: payment.id,
    accountId: account.id,
    userId: payment.userId!,
    consumptionId: consumptions[1].id,
    amount: 50,
    createdAt: payment.createdAt
  }
];

describe('ledger puro del modelo auditable', () => {
  it('aplica un pago cronologicamente por consumo y deja el saldo abierto correcto', () => {
    const applications = paymentApplications;
    const balance = calculateAccountBalance({
      account,
      users: [{ id: payment.userId!, accountId: account.id }],
      consumptions,
      financialMovements: [payment],
      applications
    });
    const statuses = calculateConsumptionPaymentStatuses({ consumptions, applications });

    expect(balance).toMatchObject({
      consumed: 180,
      paid: 150,
      balance: 30,
      unappliedCredit: 0
    });
    expect(statuses).toEqual([
      expect.objectContaining({ consumptionId: consumptions[0].id, paid: 100, openAmount: 0, status: 'paid' }),
      expect.objectContaining({ consumptionId: consumptions[1].id, paid: 50, openAmount: 30, status: 'partial' })
    ]);
  });

  it('un reverso firmado reabre exactamente los consumos aplicados', () => {
    const reversal: FinancialMovement = {
      ...payment,
      id: '00000000-0000-4000-8000-000000000302',
      movementType: 'payment_reversal',
      amount: -150,
      reversedMovementId: payment.id,
      requestId: '00000000-0000-4000-8000-000000000402',
      createdAt: '2026-07-14T14:00:00.000Z'
    };
    const reversedApplications: PaymentApplication[] = paymentApplications.map((application, index) => ({
      ...application,
      id: `00000000-0000-4000-8000-00000000060${index + 1}`,
      financialMovementId: reversal.id,
      amount: -application.amount,
      reversedApplicationId: application.id,
      createdAt: reversal.createdAt
    }));
    const applications = [...paymentApplications, ...reversedApplications];

    const balance = calculateAccountBalance({
      account,
      users: [{ id: payment.userId!, accountId: account.id }],
      consumptions,
      financialMovements: [payment, reversal],
      applications
    });
    const statuses = calculateConsumptionPaymentStatuses({ consumptions, applications });

    expect(balance).toMatchObject({ consumed: 180, paid: 0, balance: 180, unappliedCredit: 0 });
    expect(statuses).toEqual([
      expect.objectContaining({ consumptionId: consumptions[0].id, paid: 0, openAmount: 100, status: 'unpaid' }),
      expect.objectContaining({ consumptionId: consumptions[1].id, paid: 0, openAmount: 80, status: 'unpaid' })
    ]);
  });

  it('calcula FIFO 10 x 100 + 5 x 120 = 1600 a partir de asignaciones', () => {
    const sale: Consumption = {
      id: '00000000-0000-4000-8000-000000000701',
      clientOperationId: '00000000-0000-4000-8000-000000000702',
      userId: payment.userId!,
      status: 'confirmed',
      total: 3000,
      createdAt
    };
    const item: ConsumptionItem = {
      id: '00000000-0000-4000-8000-000000000703',
      consumptionId: sale.id,
      productId: '00000000-0000-4000-8000-000000000704',
      productName: 'Producto FIFO',
      quantity: 15,
      unitPrice: 200,
      total: 3000,
      createdAt
    };
    const firstLayer: FifoCostAllocation = {
      id: '00000000-0000-4000-8000-000000000705',
      productId: item.productId,
      consumptionItemId: item.id,
      targetMovementId: '00000000-0000-4000-8000-000000000706',
      sourceMovementId: '00000000-0000-4000-8000-000000000707',
      quantity: 10,
      unitCost: 100,
      totalCost: 1000,
      createdAt
    };
    const secondLayer: FifoCostAllocation = {
      ...firstLayer,
      id: '00000000-0000-4000-8000-000000000708',
      sourceMovementId: '00000000-0000-4000-8000-000000000709',
      quantity: 5,
      unitCost: 120,
      totalCost: 600
    };

    expect(
      calculateConsumptionCosts({
        consumptions: [sale],
        items: [item],
        allocations: [firstLayer, secondLayer]
      })
    ).toEqual([
      {
        consumptionId: sale.id,
        costTotal: 1600,
        pendingCostQuantity: 0,
        costStatus: 'final'
      }
    ]);
  });

  it('mantiene costo pendiente hasta que una nueva asignacion completa la cantidad', () => {
    const sale: Consumption = {
      id: '00000000-0000-4000-8000-000000000801',
      clientOperationId: '00000000-0000-4000-8000-000000000802',
      userId: payment.userId!,
      status: 'confirmed',
      total: 3000,
      createdAt
    };
    const item: ConsumptionItem = {
      id: '00000000-0000-4000-8000-000000000803',
      consumptionId: sale.id,
      productId: '00000000-0000-4000-8000-000000000804',
      productName: 'Producto pendiente',
      quantity: 15,
      unitPrice: 200,
      total: 3000,
      createdAt
    };
    const available: FifoCostAllocation = {
      id: '00000000-0000-4000-8000-000000000805',
      productId: item.productId,
      consumptionItemId: item.id,
      targetMovementId: '00000000-0000-4000-8000-000000000806',
      sourceMovementId: '00000000-0000-4000-8000-000000000807',
      quantity: 10,
      unitCost: 100,
      totalCost: 1000,
      createdAt
    };

    const pending = calculateConsumptionCosts({
      consumptions: [sale],
      items: [item],
      allocations: [available]
    })[0];
    const completed = calculateConsumptionCosts({
      consumptions: [sale],
      items: [item],
      allocations: [
        available,
        {
          ...available,
          id: '00000000-0000-4000-8000-000000000808',
          sourceMovementId: '00000000-0000-4000-8000-000000000809',
          quantity: 5,
          unitCost: 120,
          totalCost: 600
        }
      ]
    })[0];

    expect(pending).toMatchObject({ costTotal: 1000, pendingCostQuantity: 5, costStatus: 'pending_inventory' });
    expect(completed).toMatchObject({ costTotal: 1600, pendingCostQuantity: 0, costStatus: 'final' });
  });
});
