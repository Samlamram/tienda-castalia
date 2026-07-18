import type {
  AdminSnapshot,
  AppSession,
  CatalogProduct,
  PendingConsumption,
  Setting,
  TiendaViewData
} from './types';

export const EMPTY_ADMIN_SNAPSHOT: AdminSnapshot = {
  accounts: [],
  users: [],
  products: [],
  consumptions: [],
  consumptionItems: [],
  financialMovements: [],
  paymentApplications: [],
  inventoryMovements: [],
  financeEvents: [],
  fifoCostAllocations: [],
  auditLog: [],
  productStocks: [],
  consumptionCosts: [],
  userBalances: [],
  accountBalances: [],
  consumptionPaymentStatuses: [],
  catalogVersion: 0,
  generatedAt: ''
};

export function adminSnapshotToViewData(
  snapshot: AdminSnapshot,
  settings: Setting[] = []
): TiendaViewData {
  const reversalsByOriginal = new Map(
    snapshot.financialMovements
      .filter((movement) => movement.reversedMovementId)
      .map((movement) => [movement.reversedMovementId as string, movement.id])
  );

  const payments = snapshot.financialMovements
    .filter((movement) => movement.movementType === 'payment')
    .map((movement) => {
      const applied = snapshot.paymentApplications
        .filter((application) => application.financialMovementId === movement.id)
        .reduce((sum, application) => sum + application.amount, 0);
      return {
        id: movement.id,
        accountId: movement.accountId,
        targetType: movement.scope,
        userId: movement.userId,
        paidByUserId: movement.paidByUserId,
        amount: movement.amount,
        unappliedAmount: movement.unappliedAmount ?? Math.max(0, movement.amount - applied),
        note: movement.note,
        reversedMovementId: reversalsByOriginal.get(movement.id),
        createdAt: movement.createdAt
      };
    });

  const adjustments = snapshot.financialMovements
    .filter(
      (movement) =>
        movement.movementType === 'adjustment' || movement.movementType === 'adjustment_reversal'
    )
    .map((movement) => ({
      id: movement.id,
      accountId: movement.accountId,
      scope: movement.scope,
      userId: movement.userId,
      movementType: movement.movementType as 'adjustment' | 'adjustment_reversal',
      amount: movement.amount,
      note: movement.note ?? 'Ajuste administrativo',
      reversalOfId: movement.movementType === 'adjustment_reversal' ? movement.reversedMovementId : undefined,
      reversedByMovementId: movement.movementType === 'adjustment' ? reversalsByOriginal.get(movement.id) : undefined,
      createdAt: movement.createdAt
    }));

  const purchases = snapshot.inventoryMovements
    .filter((movement) => movement.movementType === 'purchase' && movement.quantityDelta > 0)
    .map((movement) => ({
      id: movement.id,
      productId: movement.productId,
      quantity: movement.quantityDelta,
      unitCost: movement.unitCost ?? 0,
      totalCost: movement.quantityDelta * (movement.unitCost ?? 0),
      note: movement.note,
      createdAt: movement.createdAt
    }));

  const products = snapshot.products.map((product) => {
    const stockProjection = snapshot.productStocks.find((entry) => entry.productId === product.id);
    const latestPurchase = purchases
      .filter((purchase) => purchase.productId === product.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return {
      ...product,
      lastCost: stockProjection?.lastCost ?? latestPurchase?.unitCost ?? product.lastCost ?? 0
    };
  });

  return {
    accounts: snapshot.accounts,
    users: snapshot.users,
    products,
    consumptions: snapshot.consumptions,
    items: snapshot.consumptionItems,
    financialMovements: snapshot.financialMovements,
    payments,
    applications: snapshot.paymentApplications,
    purchases,
    movements: snapshot.inventoryMovements,
    financeEvents: snapshot.financeEvents,
    adjustments,
    fifoCostAllocations: snapshot.fifoCostAllocations,
    auditLog: snapshot.auditLog,
    pendingSync: 0,
    pendingConsumptions: [],
    settings,
    accountBalances: snapshot.accountBalances,
    userBalances: snapshot.userBalances,
    productStocks: snapshot.productStocks,
    consumptionCosts: snapshot.consumptionCosts,
    consumptionPaymentStatuses: snapshot.consumptionPaymentStatuses
  };
}

export function cachedUserViewData(input: {
  session: AppSession | null;
  products: CatalogProduct[];
  pendingConsumptions: PendingConsumption[];
  settings: Setting[];
  activity?: AdminSnapshot | null;
}): TiendaViewData {
  const { session } = input;
  const timestamp = session?.updatedAt ?? new Date().toISOString();
  const pendingSync = input.pendingConsumptions.filter((entry) =>
    ['pending', 'sending', 'failed'].includes(entry.status)
  ).length;
  const products = input.products.map((product) => ({
    ...product,
    stockMin: 0,
    lastCost: 0,
    createdAt: product.updatedAt
  }));
  const activityView = input.activity ? adminSnapshotToViewData(input.activity, input.settings) : null;
  const fallbackAccounts = session?.accountId
    ? [{
        id: session.accountId,
        name: session.accountName ?? 'Cuenta',
        status: 'active' as const,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1
      }]
    : [];
  const fallbackUsers = session
    ? [{
        id: session.userId,
        accountId: session.accountId,
        name: session.userName,
        role: session.role,
        status: 'active' as const,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1
      }]
    : [];
  const accounts = activityView?.accounts.length ? activityView.accounts : fallbackAccounts;
  const users = activityView?.users.length ? activityView.users : fallbackUsers;
  const balance = session?.balance ?? 0;
  const userBalances = session
    ? [{
        userId: session.userId,
        accountId: session.accountId,
        consumed: balance,
        paid: 0,
        adjustments: 0,
        balance,
        unappliedCredit: 0
      }]
    : [];
  const accountBalances = session?.accountId
    ? [{
        accountId: session.accountId,
        consumed: balance,
        paid: 0,
        adjustments: 0,
        balance,
        unappliedCredit: 0,
        users: userBalances
      }]
    : [];
  const resolvedUserBalances = activityView?.userBalances.length ? activityView.userBalances : userBalances;
  const resolvedAccountBalances = activityView?.accountBalances.length ? activityView.accountBalances : accountBalances;

  return {
    accounts,
    users,
    products,
    consumptions: activityView?.consumptions ?? [],
    items: activityView?.items ?? [],
    financialMovements: activityView?.financialMovements ?? [],
    payments: activityView?.payments ?? [],
    applications: activityView?.applications ?? [],
    purchases: [],
    movements: [],
    financeEvents: [],
    adjustments: activityView?.adjustments ?? [],
    fifoCostAllocations: [],
    auditLog: [],
    pendingSync,
    pendingConsumptions: input.pendingConsumptions,
    settings: input.settings,
    accountBalances: resolvedAccountBalances,
    userBalances: resolvedUserBalances,
    productStocks: products.map((product) => ({
      productId: product.id,
      stock: 0,
      stockMin: 0,
      isLow: false
    })),
    consumptionCosts: [],
    consumptionPaymentStatuses: activityView?.consumptionPaymentStatuses ?? []
  };
}
