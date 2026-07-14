import type {
  Account,
  AccountBalance,
  Consumption,
  ConsumptionCost,
  ConsumptionItem,
  ConsumptionPaymentStatus,
  FifoCostAllocation,
  FinancialMovement,
  InventoryMovement,
  PaymentApplication,
  Product,
  ProductStock,
  UserBalance
} from './types';

const MONEY_FACTOR = 100;
const QUANTITY_FACTOR = 1_000;

function round(value: number, factor: number): number {
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function roundMoney(value: number): number {
  return round(value, MONEY_FACTOR);
}

export function roundQuantity(value: number): number {
  return round(value, QUANTITY_FACTOR);
}

function applicationsForMovement(
  movementId: string,
  applications: PaymentApplication[]
): number {
  return applications
    .filter((application) => application.financialMovementId === movementId)
    .reduce((sum, application) => sum + application.amount, 0);
}

function unappliedPaymentForUser(
  userId: string,
  movements: FinancialMovement[],
  applications: PaymentApplication[]
): number {
  return movements
    .filter(
      (movement) =>
        (movement.movementType === 'payment' ||
          movement.movementType === 'payment_reversal') &&
        (movement.paidByUserId ?? movement.userId) === userId
    )
    .reduce(
      (sum, movement) =>
        sum + movement.amount - applicationsForMovement(movement.id, applications),
      0
    );
}

export function calculateUserBalances(input: {
  accountId?: string;
  users: { id: string; accountId?: string }[];
  consumptions: Consumption[];
  financialMovements: FinancialMovement[];
  applications: PaymentApplication[];
}): UserBalance[] {
  const scopedUsers = input.accountId
    ? input.users.filter((user) => user.accountId === input.accountId)
    : input.users;

  return scopedUsers.map((user) => {
    const consumed = input.consumptions
      .filter((consumption) => consumption.userId === user.id && consumption.status === 'confirmed')
      .reduce((sum, consumption) => sum + consumption.total, 0);
    const appliedPaid = input.applications
      .filter((application) => application.userId === user.id)
      .reduce((sum, application) => sum + application.amount, 0);
    const unappliedCredit = unappliedPaymentForUser(
      user.id,
      input.financialMovements,
      input.applications
    );
    const adjustments = input.financialMovements
      .filter(
        (movement) =>
          (movement.movementType === 'adjustment' ||
            movement.movementType === 'adjustment_reversal') &&
          movement.scope === 'user' &&
          movement.userId === user.id
      )
      .reduce((sum, movement) => sum + movement.amount, 0);
    const paid = appliedPaid + unappliedCredit;

    return {
      userId: user.id,
      accountId: user.accountId,
      consumed: roundMoney(consumed),
      paid: roundMoney(paid),
      adjustments: roundMoney(adjustments),
      balance: roundMoney(consumed - paid + adjustments),
      unappliedCredit: roundMoney(unappliedCredit)
    };
  });
}

export function calculateAccountBalance(input: {
  account: Account;
  users: { id: string; accountId?: string }[];
  consumptions: Consumption[];
  financialMovements: FinancialMovement[];
  applications: PaymentApplication[];
}): AccountBalance {
  const users = calculateUserBalances({
    accountId: input.account.id,
    users: input.users,
    consumptions: input.consumptions,
    financialMovements: input.financialMovements,
    applications: input.applications
  });
  const accountAdjustments = input.financialMovements
    .filter(
      (movement) =>
        (movement.movementType === 'adjustment' ||
          movement.movementType === 'adjustment_reversal') &&
        movement.scope === 'account' &&
        movement.accountId === input.account.id
    )
    .reduce((sum, movement) => sum + movement.amount, 0);
  const consumed = users.reduce((sum, user) => sum + user.consumed, 0);
  const paid = users.reduce((sum, user) => sum + user.paid, 0);
  const adjustments =
    users.reduce((sum, user) => sum + user.adjustments, 0) + accountAdjustments;
  const unappliedCredit = users.reduce((sum, user) => sum + user.unappliedCredit, 0);

  return {
    accountId: input.account.id,
    consumed: roundMoney(consumed),
    paid: roundMoney(paid),
    adjustments: roundMoney(adjustments),
    balance: roundMoney(consumed - paid + adjustments),
    unappliedCredit: roundMoney(unappliedCredit),
    users
  };
}

export function calculateProductStocks(
  products: Product[],
  movements: InventoryMovement[]
): ProductStock[] {
  return products.map((product) => {
    const stock = movements
      .filter((movement) => movement.productId === product.id)
      .reduce((sum, movement) => sum + movement.quantityDelta, 0);
    const roundedStock = roundQuantity(stock);

    return {
      productId: product.id,
      stock: roundedStock,
      stockMin: product.stockMin,
      isLow: roundedStock <= product.stockMin
    };
  });
}

export function consumptionOpenAmount(
  consumption: Consumption,
  applications: PaymentApplication[]
): number {
  if (consumption.status !== 'confirmed') return 0;
  const paid = applications
    .filter((application) => application.consumptionId === consumption.id)
    .reduce((sum, application) => sum + application.amount, 0);
  return roundMoney(Math.max(0, consumption.total - paid));
}

export function calculateConsumptionPaymentStatuses(input: {
  consumptions: Consumption[];
  applications: PaymentApplication[];
}): ConsumptionPaymentStatus[] {
  return input.consumptions.map((consumption) => {
    const paid = input.applications
      .filter((application) => application.consumptionId === consumption.id)
      .reduce((sum, application) => sum + application.amount, 0);
    const normalizedPaid = roundMoney(Math.max(0, paid));
    const openAmount = consumptionOpenAmount(consumption, input.applications);
    const status =
      consumption.status === 'voided'
        ? ('voided' as const)
        : openAmount === 0
          ? ('paid' as const)
          : normalizedPaid > 0
            ? ('partial' as const)
            : ('unpaid' as const);

    return {
      consumptionId: consumption.id,
      userId: consumption.userId,
      accountId: consumption.accountId,
      total: roundMoney(consumption.total),
      paid: consumption.status === 'voided' ? 0 : normalizedPaid,
      openAmount,
      status
    };
  });
}

export function calculateOpenConsumptions(input: {
  accountId?: string;
  userId?: string;
  userIds?: string[];
  consumptions: Consumption[];
  applications: PaymentApplication[];
}): Array<Consumption & { openAmount: number }> {
  const userIdSet = input.userIds ? new Set(input.userIds) : undefined;

  return input.consumptions
    .filter((consumption) => {
      if (input.userId) return consumption.userId === input.userId;
      if (userIdSet) return userIdSet.has(consumption.userId);
      return input.accountId ? consumption.accountId === input.accountId : true;
    })
    .map((consumption) => ({
      ...consumption,
      openAmount: consumptionOpenAmount(consumption, input.applications)
    }))
    .filter((consumption) => consumption.openAmount > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function calculateConsumptionCosts(input: {
  consumptions: Consumption[];
  items: ConsumptionItem[];
  allocations: FifoCostAllocation[];
}): ConsumptionCost[] {
  return input.consumptions.map((consumption) => {
    if (consumption.status === 'voided') {
      return {
        consumptionId: consumption.id,
        costTotal: 0,
        pendingCostQuantity: 0,
        costStatus: 'final'
      };
    }

    const items = input.items.filter((item) => item.consumptionId === consumption.id);
    let costTotal = 0;
    let pendingCostQuantity = 0;

    for (const item of items) {
      const allocations = input.allocations.filter(
        (allocation) => allocation.consumptionItemId === item.id
      );
      const allocatedQuantity = allocations.reduce(
        (sum, allocation) => sum + allocation.quantity,
        0
      );
      costTotal += allocations.reduce((sum, allocation) => sum + allocation.totalCost, 0);
      pendingCostQuantity += Math.max(0, item.quantity - allocatedQuantity);
    }

    const roundedPending = roundQuantity(pendingCostQuantity);
    return {
      consumptionId: consumption.id,
      costTotal: roundMoney(costTotal),
      pendingCostQuantity: roundedPending,
      costStatus: roundedPending > 0 ? 'pending_inventory' : 'final'
    };
  });
}
