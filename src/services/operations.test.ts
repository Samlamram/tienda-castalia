import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { calculateAccountBalance, calculateProductStocks } from '../domain/ledger';
import {
  createAccount,
  createConsumption,
  createPayment,
  createProduct,
  createPurchase,
  createUser,
  independizeUser
} from './operations';

async function resetDb() {
  await db.delete();
  await db.open();
}

async function snapshot() {
  const [accounts, users, products, consumptions, items, payments, applications, adjustments, movements] =
    await Promise.all([
      db.accounts.toArray(),
      db.users.toArray(),
      db.products.toArray(),
      db.consumptions.toArray(),
      db.consumptionItems.toArray(),
      db.payments.toArray(),
      db.paymentApplications.toArray(),
      db.adjustments.toArray(),
      db.inventoryMovements.toArray()
    ]);
  return { accounts, users, products, consumptions, items, payments, applications, adjustments, movements };
}

describe('business operations', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('applies account payments to oldest user consumptions', async () => {
    const account = await createAccount('Familia');
    const userA = await createUser({ accountId: account.id, name: 'A', pin: '1234' });
    const userB = await createUser({ accountId: account.id, name: 'B', pin: '1234' });
    const product = await createProduct({ name: 'Agua', category: 'Bebidas', price: 2000, stockMin: 0, lastCost: 1000 });
    await createPurchase({ productId: product.id, quantity: 10, unitCost: 1000 });
    await createConsumption(userA.id, [{ productId: product.id, quantity: 2 }]);
    await createConsumption(userB.id, [{ productId: product.id, quantity: 1 }]);
    await createPayment({ accountId: account.id, targetType: 'account', amount: 4500 });

    const state = await snapshot();
    const balance = calculateAccountBalance({ account, ...state });
    const balanceA = balance.users.find((entry) => entry.userId === userA.id);
    const balanceB = balance.users.find((entry) => entry.userId === userB.id);

    expect(balance.balance).toBe(1500);
    expect(balanceA?.balance).toBe(0);
    expect(balanceB?.balance).toBe(1500);
  });

  it('allows negative stock and recalculates pending FIFO cost with the next purchase', async () => {
    const account = await createAccount('Familia');
    const user = await createUser({ accountId: account.id, name: 'A', pin: '1234' });
    const product = await createProduct({ name: 'Papas', category: 'Snacks', price: 3000, stockMin: 0, lastCost: 1000 });

    await createConsumption(user.id, [{ productId: product.id, quantity: 2 }]);
    let items = await db.consumptionItems.toArray();
    expect(items[0].pendingCostQuantity).toBe(2);
    expect(items[0].costStatus).toBe('pending_recalc');

    await createPurchase({ productId: product.id, quantity: 2, unitCost: 1500 });
    items = await db.consumptionItems.toArray();
    const state = await snapshot();
    const stock = calculateProductStocks(state.products, state.movements).find((entry) => entry.productId === product.id);

    expect(items[0].pendingCostQuantity).toBe(0);
    expect(items[0].costTotal).toBe(3000);
    expect(stock?.stock).toBe(0);
  });

  it('moves only the pending user balance when a user is independized', async () => {
    const account = await createAccount('Familia');
    const userA = await createUser({ accountId: account.id, name: 'Hijo', pin: '1234' });
    const userB = await createUser({ accountId: account.id, name: 'Mama', pin: '1234' });
    const product = await createProduct({ name: 'Gaseosa', category: 'Bebidas', price: 3500, stockMin: 0, lastCost: 2000 });
    await createPurchase({ productId: product.id, quantity: 10, unitCost: 2000 });
    await createConsumption(userA.id, [{ productId: product.id, quantity: 2 }]);
    await createConsumption(userB.id, [{ productId: product.id, quantity: 1 }]);
    await createPayment({ accountId: account.id, targetType: 'user', userId: userA.id, amount: 2000 });

    const transfer = await independizeUser(userA.id, 'Cuenta Hijo');
    const state = await snapshot();
    const oldBalance = calculateAccountBalance({ account, ...state });
    const newAccount = state.accounts.find((entry) => entry.id === transfer.toAccountId)!;
    const newBalance = calculateAccountBalance({ account: newAccount, ...state });

    expect(transfer.movedBalance).toBe(5000);
    expect(oldBalance.balance).toBe(3500);
    expect(newBalance.balance).toBe(5000);
  });
});
