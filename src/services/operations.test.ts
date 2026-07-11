import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { calculateAccountBalance, calculateProductStocks, calculateUserBalances } from '../domain/ledger';
import {
  assignUserToAccount,
  createAccount,
  createConsumption,
  createPayment,
  createProduct,
  createPurchase,
  createUser,
  independizeUser,
  removeUserFromAccount
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
    await createPayment({ accountId: account.id, targetType: 'account', paidByUserId: userA.id, amount: 4500 });

    const state = await snapshot();
    const balance = calculateAccountBalance({ account, ...state });
    const balanceA = balance.users.find((entry) => entry.userId === userA.id);
    const balanceB = balance.users.find((entry) => entry.userId === userB.id);

    expect(balance.balance).toBe(1500);
    expect(balanceA?.balance).toBe(0);
    expect(balanceB?.balance).toBe(1500);
  });

  it('keeps balance on an independent user without an account', async () => {
    const user = await createUser({ name: 'Independiente', pin: '1234' });
    const product = await createProduct({ name: 'Jugo', category: 'Bebidas', price: 2500, stockMin: 0, lastCost: 1200 });
    await createPurchase({ productId: product.id, quantity: 5, unitCost: 1200 });
    await createConsumption(user.id, [{ productId: product.id, quantity: 2 }]);

    const state = await snapshot();
    const balance = calculateUserBalances(state).find((entry) => entry.userId === user.id);

    expect(state.consumptions[0].accountId).toBeUndefined();
    expect(balance?.accountId).toBeUndefined();
    expect(balance?.balance).toBe(5000);
  });

  it('moves aggregate account balance by assigning and removing a user without transfer adjustments', async () => {
    const account = await createAccount('Grupo');
    const user = await createUser({ name: 'A', pin: '1234' });
    const product = await createProduct({ name: 'Cafe', category: 'Bebidas', price: 3000, stockMin: 0, lastCost: 1000 });
    await createPurchase({ productId: product.id, quantity: 3, unitCost: 1000 });
    await createConsumption(user.id, [{ productId: product.id, quantity: 1 }]);

    let state = await snapshot();
    expect(calculateAccountBalance({ account, ...state }).balance).toBe(0);

    await assignUserToAccount(user.id, account.id);
    state = await snapshot();
    expect(calculateAccountBalance({ account, ...state }).balance).toBe(3000);

    await removeUserFromAccount(user.id);
    state = await snapshot();
    expect(calculateAccountBalance({ account, ...state }).balance).toBe(0);
    expect(state.adjustments).toHaveLength(0);
    expect(calculateUserBalances(state).find((entry) => entry.userId === user.id)?.balance).toBe(3000);
  });

  it('leaves overpaid account payment as credit for the paying user', async () => {
    const account = await createAccount('Familia');
    const userA = await createUser({ accountId: account.id, name: 'A', pin: '1234' });
    const userB = await createUser({ accountId: account.id, name: 'B', pin: '1234' });
    const product = await createProduct({ name: 'Pan', category: 'Comida', price: 2000, stockMin: 0, lastCost: 800 });
    await createPurchase({ productId: product.id, quantity: 5, unitCost: 800 });
    await createConsumption(userA.id, [{ productId: product.id, quantity: 1 }]);

    const payment = await createPayment({ accountId: account.id, targetType: 'account', paidByUserId: userB.id, amount: 3000 });
    const state = await snapshot();
    const balance = calculateAccountBalance({ account, ...state });
    const balanceA = balance.users.find((entry) => entry.userId === userA.id);
    const balanceB = balance.users.find((entry) => entry.userId === userB.id);

    expect(payment.unappliedAmount).toBe(1000);
    expect(balance.balance).toBe(-1000);
    expect(balanceA?.balance).toBe(0);
    expect(balanceB?.balance).toBe(-1000);
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
    await createPayment({ accountId: account.id, targetType: 'user', userId: userA.id, paidByUserId: userA.id, amount: 2000 });

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
