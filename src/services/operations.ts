import { db } from '../data/db';
import { calculateAccountBalance, calculateOpenItems, itemOpenAmount } from '../domain/ledger';
import type {
  Account,
  AccountTransfer,
  BalanceAdjustment,
  CartItem,
  Consumption,
  ConsumptionItem,
  InventoryLot,
  InventoryMovement,
  Payment,
  PaymentApplication,
  PersonUser,
  Product,
  Purchase
} from '../domain/types';
import { createId, nowIso } from '../utils/id';
import { clampAmount } from '../utils/money';
import { hashPin } from '../utils/security';

async function enqueue(entity: string, entityId: string, payload: unknown): Promise<void> {
  await db.syncOperations.add({
    id: createId('sync'),
    entity,
    entityId,
    action: 'upsert',
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: nowIso()
  });
}

async function putAndQueue<T extends { id: string }>(
  table: { put: (value: T) => PromiseLike<unknown> },
  entity: string,
  item: T
): Promise<void> {
  await table.put(item);
  await enqueue(entity, item.id, item);
}

export async function createAccount(name: string): Promise<Account> {
  const timestamp = nowIso();
  const account: Account = {
    id: createId('acct'),
    name: name.trim(),
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await putAndQueue(db.accounts, 'accounts', account);
  return account;
}

export async function updateAccount(account: Account): Promise<void> {
  const updated = { ...account, name: account.name.trim(), updatedAt: nowIso() };
  await putAndQueue(db.accounts, 'accounts', updated);
}

export async function createUser(input: { accountId: string; name: string; pin: string }): Promise<PersonUser> {
  const timestamp = nowIso();
  const user: PersonUser = {
    id: createId('usr'),
    accountId: input.accountId,
    name: input.name.trim(),
    pinHash: await hashPin(input.pin),
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await putAndQueue(db.users, 'users', user);
  return user;
}

export async function updateUser(input: PersonUser & { newPin?: string }): Promise<void> {
  const updated: PersonUser = {
    ...input,
    name: input.name.trim(),
    pinHash: input.newPin ? await hashPin(input.newPin) : input.pinHash,
    updatedAt: nowIso()
  };
  await putAndQueue(db.users, 'users', updated);
}

export async function createProduct(input: {
  name: string;
  category: string;
  price: number;
  stockMin: number;
  lastCost: number;
  imageUrl?: string;
  imageSourceUrl?: string;
  imageCredit?: string;
}): Promise<Product> {
  const timestamp = nowIso();
  const product: Product = {
    id: createId('prd'),
    name: input.name.trim(),
    category: input.category.trim() || 'General',
    price: clampAmount(input.price),
    stockMin: Math.max(0, Number(input.stockMin) || 0),
    lastCost: clampAmount(input.lastCost),
    imageUrl: input.imageUrl?.trim() || undefined,
    imageSourceUrl: input.imageSourceUrl?.trim() || undefined,
    imageCredit: input.imageCredit?.trim() || undefined,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await putAndQueue(db.products, 'products', product);
  return product;
}

export async function updateProduct(product: Product): Promise<void> {
  const updated = {
    ...product,
    name: product.name.trim(),
    category: product.category.trim() || 'General',
    price: clampAmount(product.price),
    stockMin: Math.max(0, Number(product.stockMin) || 0),
    lastCost: clampAmount(product.lastCost),
    imageUrl: product.imageUrl?.trim() || undefined,
    imageSourceUrl: product.imageSourceUrl?.trim() || undefined,
    imageCredit: product.imageCredit?.trim() || undefined,
    updatedAt: nowIso()
  };
  await putAndQueue(db.products, 'products', updated);
}

async function allocateCost(product: Product, quantity: number, referenceId: string, timestamp: string) {
  const lots = await db.inventoryLots
    .where('productId')
    .equals(product.id)
    .filter((lot) => lot.remainingQuantity > 0)
    .sortBy('createdAt');
  let remaining = quantity;
  let costTotal = 0;

  for (const lot of lots) {
    if (remaining <= 0) break;
    const used = Math.min(remaining, lot.remainingQuantity);
    remaining -= used;
    costTotal += used * lot.unitCost;
    await putAndQueue(db.inventoryLots, 'inventory_lots', {
      ...lot,
      remainingQuantity: lot.remainingQuantity - used
    });
  }

  const movement: InventoryMovement = {
    id: createId('mov'),
    productId: product.id,
    type: 'consumption',
    quantityDelta: -quantity,
    unitCost: product.lastCost,
    referenceId,
    createdAt: timestamp
  };
  await putAndQueue(db.inventoryMovements, 'inventory_movements', movement);

  return {
    costTotal,
    pendingCostQuantity: remaining,
    costStatus: remaining > 0 ? ('pending_recalc' as const) : ('final' as const)
  };
}

export async function createConsumption(userId: string, cart: CartItem[]): Promise<Consumption> {
  const normalizedCart = cart
    .map((item) => ({ productId: item.productId, quantity: Math.max(0, Number(item.quantity) || 0) }))
    .filter((item) => item.quantity > 0);

  if (normalizedCart.length === 0) {
    throw new Error('El carrito está vacío.');
  }

  return db.transaction(
    'rw',
    [
      db.users,
      db.products,
      db.consumptions,
      db.consumptionItems,
      db.inventoryLots,
      db.inventoryMovements,
      db.syncOperations
    ],
    async () => {
      const user = await db.users.get(userId);
      if (!user || user.status !== 'active') throw new Error('Usuario no disponible.');

      const timestamp = nowIso();
      const consumptionId = createId('con');
      const items: ConsumptionItem[] = [];
      let total = 0;
      let costTotal = 0;
      let hasPendingCost = false;

      for (const cartItem of normalizedCart) {
        const product = await db.products.get(cartItem.productId);
        if (!product || product.status !== 'active') {
          throw new Error('Producto no disponible.');
        }

        const priceTotal = product.price * cartItem.quantity;
        const allocation = await allocateCost(product, cartItem.quantity, consumptionId, timestamp);
        total += priceTotal;
        costTotal += allocation.costTotal;
        hasPendingCost = hasPendingCost || allocation.costStatus === 'pending_recalc';

        items.push({
          id: createId('item'),
          consumptionId,
          accountId: user.accountId,
          userId: user.id,
          productId: product.id,
          productName: product.name,
          quantity: cartItem.quantity,
          unitPrice: product.price,
          total: priceTotal,
          unitCost: cartItem.quantity > 0 ? allocation.costTotal / cartItem.quantity : 0,
          costTotal: allocation.costTotal,
          pendingCostQuantity: allocation.pendingCostQuantity,
          costStatus: allocation.costStatus,
          createdAt: timestamp
        });
      }

      const consumption: Consumption = {
        id: consumptionId,
        accountId: user.accountId,
        userId: user.id,
        status: 'confirmed',
        total,
        costTotal,
        costStatus: hasPendingCost ? 'pending_recalc' : 'final',
        createdAt: timestamp
      };

      await putAndQueue(db.consumptions, 'consumptions', consumption);
      for (const item of items) {
        await putAndQueue(db.consumptionItems, 'consumption_items', item);
      }

      return consumption;
    }
  );
}

async function refreshConsumptionCost(consumptionId: string): Promise<void> {
  const consumption = await db.consumptions.get(consumptionId);
  if (!consumption) return;
  const items = await db.consumptionItems.where('consumptionId').equals(consumptionId).toArray();
  const costTotal = items.reduce((sum, item) => sum + item.costTotal, 0);
  const costStatus = items.some((item) => item.pendingCostQuantity > 0) ? ('pending_recalc' as const) : ('final' as const);
  await putAndQueue(db.consumptions, 'consumptions', {
    ...consumption,
    costTotal,
    costStatus
  });
}

async function reconcilePendingCosts(productId: string): Promise<void> {
  const pendingItems = await db.consumptionItems
    .where('productId')
    .equals(productId)
    .filter((item) => item.pendingCostQuantity > 0)
    .sortBy('createdAt');

  const lots = await db.inventoryLots
    .where('productId')
    .equals(productId)
    .filter((lot) => lot.remainingQuantity > 0)
    .sortBy('createdAt');

  for (const item of pendingItems) {
    let pending = item.pendingCostQuantity;
    let addedCost = 0;

    for (const lot of lots) {
      if (pending <= 0) break;
      if (lot.remainingQuantity <= 0) continue;
      const used = Math.min(pending, lot.remainingQuantity);
      pending -= used;
      addedCost += used * lot.unitCost;
      lot.remainingQuantity -= used;
      await putAndQueue(db.inventoryLots, 'inventory_lots', lot);
    }

    if (addedCost > 0 || pending !== item.pendingCostQuantity) {
      const resolvedQuantity = item.pendingCostQuantity - pending;
      const updatedCostTotal = item.costTotal + addedCost;
      const updated: ConsumptionItem = {
        ...item,
        costTotal: updatedCostTotal,
        unitCost: item.quantity > 0 ? updatedCostTotal / item.quantity : 0,
        pendingCostQuantity: pending,
        costStatus: pending > 0 ? 'pending_recalc' : 'final'
      };
      await putAndQueue(db.consumptionItems, 'consumption_items', updated);
      await putAndQueue(db.inventoryMovements, 'inventory_movements', {
        id: createId('mov'),
        productId,
        type: 'cost_recalc' as const,
        quantityDelta: 0,
        unitCost: resolvedQuantity > 0 ? addedCost / resolvedQuantity : undefined,
        referenceId: item.id,
        note: `Recalculo de ${resolvedQuantity} unidades pendientes`,
        createdAt: nowIso()
      });
      await refreshConsumptionCost(item.consumptionId);
    }
  }
}

export async function createPurchase(input: {
  productId: string;
  quantity: number;
  unitCost: number;
  note?: string;
}): Promise<Purchase> {
  const quantity = Math.max(0, Number(input.quantity) || 0);
  const unitCost = clampAmount(input.unitCost);
  if (quantity <= 0) throw new Error('La cantidad debe ser mayor a cero.');

  return db.transaction(
    'rw',
    [
      db.products,
      db.purchases,
      db.inventoryLots,
      db.inventoryMovements,
      db.consumptions,
      db.consumptionItems,
      db.syncOperations
    ],
    async () => {
      const product = await db.products.get(input.productId);
      if (!product) throw new Error('Producto no encontrado.');
      const timestamp = nowIso();
      const purchase: Purchase = {
        id: createId('pur'),
        productId: product.id,
        quantity,
        unitCost,
        totalCost: quantity * unitCost,
        note: input.note?.trim() || undefined,
        createdAt: timestamp
      };
      const lot: InventoryLot = {
        id: createId('lot'),
        productId: product.id,
        purchaseId: purchase.id,
        quantity,
        remainingQuantity: quantity,
        unitCost,
        createdAt: timestamp
      };
      const movement: InventoryMovement = {
        id: createId('mov'),
        productId: product.id,
        type: 'purchase',
        quantityDelta: quantity,
        unitCost,
        referenceId: purchase.id,
        createdAt: timestamp
      };

      await putAndQueue(db.purchases, 'purchases', purchase);
      await putAndQueue(db.inventoryLots, 'inventory_lots', lot);
      await putAndQueue(db.inventoryMovements, 'inventory_movements', movement);
      await putAndQueue(db.products, 'products', { ...product, lastCost: unitCost, updatedAt: timestamp });
      await reconcilePendingCosts(product.id);
      return purchase;
    }
  );
}

export async function createPayment(input: {
  accountId: string;
  targetType: 'account' | 'user';
  userId?: string;
  amount: number;
  note?: string;
}): Promise<Payment> {
  const amount = clampAmount(input.amount);
  if (amount <= 0) throw new Error('El pago debe ser mayor a cero.');

  return db.transaction(
    'rw',
    db.consumptions,
    db.consumptionItems,
    db.payments,
    db.paymentApplications,
    db.syncOperations,
    async () => {
      const timestamp = nowIso();
      const paymentId = createId('pay');
      const consumptions = await db.consumptions.where('accountId').equals(input.accountId).toArray();
      const items = await db.consumptionItems.where('accountId').equals(input.accountId).toArray();
      const applications = await db.paymentApplications.where('accountId').equals(input.accountId).toArray();
      const openItems = calculateOpenItems({
        accountId: input.accountId,
        userId: input.targetType === 'user' ? input.userId : undefined,
        consumptions,
        items,
        applications
      });

      let remaining = amount;
      for (const item of openItems) {
        if (remaining <= 0) break;
        const applied = Math.min(remaining, item.openAmount);
        remaining -= applied;
        const application: PaymentApplication = {
          id: createId('app'),
          paymentId,
          accountId: input.accountId,
          userId: item.userId,
          consumptionItemId: item.id,
          amount: applied,
          createdAt: timestamp
        };
        await putAndQueue(db.paymentApplications, 'payment_applications', application);
      }

      const payment: Payment = {
        id: paymentId,
        accountId: input.accountId,
        targetType: input.targetType,
        userId: input.targetType === 'user' ? input.userId : undefined,
        amount,
        unappliedAmount: remaining,
        note: input.note?.trim() || undefined,
        createdAt: timestamp
      };
      await putAndQueue(db.payments, 'payments', payment);
      return payment;
    }
  );
}

export async function createBalanceAdjustment(input: {
  accountId: string;
  scope: 'account' | 'user';
  userId?: string;
  amount: number;
  note: string;
}): Promise<BalanceAdjustment> {
  const adjustment: BalanceAdjustment = {
    id: createId('adj'),
    accountId: input.accountId,
    scope: input.scope,
    userId: input.scope === 'user' ? input.userId : undefined,
    amount: Math.round(Number(input.amount) || 0),
    note: input.note.trim(),
    createdAt: nowIso()
  };
  await putAndQueue(db.adjustments, 'adjustments', adjustment);
  return adjustment;
}

export async function voidConsumption(consumptionId: string, reason: string): Promise<void> {
  await db.transaction(
    'rw',
    db.consumptions,
    db.consumptionItems,
    db.inventoryLots,
    db.inventoryMovements,
    db.syncOperations,
    async () => {
      const consumption = await db.consumptions.get(consumptionId);
      if (!consumption || consumption.status === 'voided') return;
      const timestamp = nowIso();
      const items = await db.consumptionItems.where('consumptionId').equals(consumptionId).toArray();

      await putAndQueue(db.consumptions, 'consumptions', {
        ...consumption,
        status: 'voided' as const,
        voidedAt: timestamp,
        voidReason: reason.trim() || 'Anulado por admin'
      });

      for (const item of items) {
        const returnedLot: InventoryLot = {
          id: createId('lot'),
          productId: item.productId,
          purchaseId: consumption.id,
          quantity: item.quantity,
          remainingQuantity: item.quantity,
          unitCost: item.unitCost,
          createdAt: timestamp
        };
        const movement: InventoryMovement = {
          id: createId('mov'),
          productId: item.productId,
          type: 'void_consumption',
          quantityDelta: item.quantity,
          unitCost: item.unitCost,
          referenceId: consumption.id,
          createdAt: timestamp
        };
        await putAndQueue(db.inventoryLots, 'inventory_lots', returnedLot);
        await putAndQueue(db.inventoryMovements, 'inventory_movements', movement);
      }
    }
  );
}

export async function adjustInventory(input: {
  productId: string;
  quantityDelta: number;
  note: string;
}): Promise<void> {
  const product = await db.products.get(input.productId);
  if (!product) throw new Error('Producto no encontrado.');
  const quantityDelta = Number(input.quantityDelta) || 0;
  const timestamp = nowIso();

  await db.transaction('rw', db.inventoryLots, db.inventoryMovements, db.syncOperations, async () => {
    if (quantityDelta > 0) {
      await putAndQueue(db.inventoryLots, 'inventory_lots', {
        id: createId('lot'),
        productId: product.id,
        purchaseId: 'manual_adjustment',
        quantity: quantityDelta,
        remainingQuantity: quantityDelta,
        unitCost: product.lastCost,
        createdAt: timestamp
      });
    }
    await putAndQueue(db.inventoryMovements, 'inventory_movements', {
      id: createId('mov'),
      productId: product.id,
      type: 'adjustment' as const,
      quantityDelta,
      unitCost: product.lastCost,
      note: input.note.trim(),
      createdAt: timestamp
    });
  });
}

export async function independizeUser(userId: string, newAccountName: string): Promise<AccountTransfer> {
  return db.transaction(
    'rw',
    [
      db.accounts,
      db.users,
      db.consumptions,
      db.consumptionItems,
      db.payments,
      db.paymentApplications,
      db.adjustments,
      db.accountTransfers,
      db.syncOperations
    ],
    async () => {
      const user = await db.users.get(userId);
      if (!user) throw new Error('Usuario no encontrado.');
      const sourceAccount = await db.accounts.get(user.accountId);
      if (!sourceAccount) throw new Error('Cuenta origen no encontrada.');

      const users = await db.users.toArray();
      const consumptions = await db.consumptions.toArray();
      const items = await db.consumptionItems.toArray();
      const payments = await db.payments.toArray();
      const applications = await db.paymentApplications.toArray();
      const adjustments = await db.adjustments.toArray();
      const balance = calculateAccountBalance({
        account: sourceAccount,
        users,
        consumptions,
        items,
        payments,
        applications,
        adjustments
      }).users.find((entry) => entry.userId === user.id)?.balance ?? 0;

      const timestamp = nowIso();
      const newAccount: Account = {
        id: createId('acct'),
        name: newAccountName.trim() || user.name,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const transfer: AccountTransfer = {
        id: createId('trf'),
        userId,
        fromAccountId: user.accountId,
        toAccountId: newAccount.id,
        movedBalance: balance,
        note: 'Independizacion de usuario',
        createdAt: timestamp
      };

      await putAndQueue(db.accounts, 'accounts', newAccount);
      await putAndQueue(db.adjustments, 'adjustments', {
        id: createId('adj'),
        accountId: user.accountId,
        scope: 'user' as const,
        userId,
        amount: -balance,
        note: `Traslado de saldo a ${newAccount.name}`,
        createdAt: timestamp
      });
      await putAndQueue(db.users, 'users', { ...user, accountId: newAccount.id, updatedAt: timestamp });
      await putAndQueue(db.adjustments, 'adjustments', {
        id: createId('adj'),
        accountId: newAccount.id,
        scope: 'user' as const,
        userId,
        amount: balance,
        note: `Saldo trasladado desde ${sourceAccount.name}`,
        createdAt: timestamp
      });
      await putAndQueue(db.accountTransfers, 'account_transfers', transfer);
      return transfer;
    }
  );
}

export async function mergeAccounts(sourceAccountId: string, targetAccountId: string): Promise<void> {
  if (sourceAccountId === targetAccountId) return;
  await db.transaction(
    'rw',
    [
      db.accounts,
      db.users,
      db.consumptions,
      db.consumptionItems,
      db.payments,
      db.paymentApplications,
      db.adjustments,
      db.accountTransfers,
      db.syncOperations
    ],
    async () => {
      const source = await db.accounts.get(sourceAccountId);
      const target = await db.accounts.get(targetAccountId);
      if (!source || !target) throw new Error('Cuenta no encontrada.');

      const allUsers = await db.users.toArray();
      const consumptions = await db.consumptions.toArray();
      const items = await db.consumptionItems.toArray();
      const payments = await db.payments.toArray();
      const applications = await db.paymentApplications.toArray();
      const adjustments = await db.adjustments.toArray();
      const sourceBalance = calculateAccountBalance({
        account: source,
        users: allUsers,
        consumptions,
        items,
        payments,
        applications,
        adjustments
      });
      const timestamp = nowIso();

      for (const user of allUsers.filter((entry) => entry.accountId === source.id && entry.status === 'active')) {
        const movedBalance = sourceBalance.users.find((entry) => entry.userId === user.id)?.balance ?? 0;
        await putAndQueue(db.adjustments, 'adjustments', {
          id: createId('adj'),
          accountId: source.id,
          scope: 'user' as const,
          userId: user.id,
          amount: -movedBalance,
          note: `Traslado por union con ${target.name}`,
          createdAt: timestamp
        });
        await putAndQueue(db.users, 'users', { ...user, accountId: target.id, updatedAt: timestamp });
        await putAndQueue(db.adjustments, 'adjustments', {
          id: createId('adj'),
          accountId: target.id,
          scope: 'user' as const,
          userId: user.id,
          amount: movedBalance,
          note: `Saldo trasladado desde ${source.name}`,
          createdAt: timestamp
        });
        await putAndQueue(db.accountTransfers, 'account_transfers', {
          id: createId('trf'),
          userId: user.id,
          fromAccountId: source.id,
          toAccountId: target.id,
          movedBalance,
          note: 'Union de cuentas',
          createdAt: timestamp
        });
      }

      await putAndQueue(db.accounts, 'accounts', { ...source, status: 'inactive' as const, updatedAt: timestamp });
    }
  );
}

export async function getItemOpenAmount(itemId: string): Promise<number> {
  const item = await db.consumptionItems.get(itemId);
  if (!item) return 0;
  const consumptions = await db.consumptions.toArray();
  const applications = await db.paymentApplications.toArray();
  return itemOpenAmount(item, consumptions, applications);
}
