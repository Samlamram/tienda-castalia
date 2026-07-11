import type {
  Account,
  AccountBalance,
  BalanceAdjustment,
  Consumption,
  ConsumptionItem,
  InventoryMovement,
  Payment,
  PaymentApplication,
  Product,
  ProductStock,
  UserBalance
} from './types';

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function confirmedConsumptionIds(consumptions: Consumption[]): Set<string> {
  return new Set(consumptions.filter((item) => item.status === 'confirmed').map((item) => item.id));
}

export function calculateUserBalances(input: {
  accountId: string;
  users: { id: string; accountId: string }[];
  consumptions: Consumption[];
  items: ConsumptionItem[];
  payments: Payment[];
  applications: PaymentApplication[];
  adjustments: BalanceAdjustment[];
}): UserBalance[] {
  const confirmedIds = confirmedConsumptionIds(input.consumptions);
  const usersInAccount = input.users.filter((user) => user.accountId === input.accountId);

  return usersInAccount.map((user) => {
    const consumed = input.items
      .filter(
        (item) =>
          item.accountId === input.accountId && item.userId === user.id && confirmedIds.has(item.consumptionId)
      )
      .reduce((sum, item) => sum + item.total, 0);
    const appliedPaid = input.applications
      .filter((application) => application.accountId === input.accountId && application.userId === user.id)
      .reduce((sum, application) => sum + application.amount, 0);
    const unappliedUserPaid = input.payments
      .filter(
        (payment) =>
          payment.accountId === input.accountId && payment.targetType === 'user' && payment.userId === user.id
      )
      .reduce((sum, payment) => sum + payment.unappliedAmount, 0);
    const adjustments = input.adjustments
      .filter(
        (adjustment) =>
          adjustment.accountId === input.accountId && adjustment.scope === 'user' && adjustment.userId === user.id
      )
      .reduce((sum, adjustment) => sum + adjustment.amount, 0);

    const paid = appliedPaid + unappliedUserPaid;
    return {
      userId: user.id,
      accountId: user.accountId,
      consumed: round(consumed),
      paid: round(paid),
      adjustments: round(adjustments),
      balance: round(consumed - paid + adjustments)
    };
  });
}

export function calculateAccountBalance(input: {
  account: Account;
  users: { id: string; accountId: string }[];
  consumptions: Consumption[];
  items: ConsumptionItem[];
  payments: Payment[];
  applications: PaymentApplication[];
  adjustments: BalanceAdjustment[];
}): AccountBalance {
  const confirmed = input.consumptions.filter(
    (consumption) => consumption.accountId === input.account.id && consumption.status === 'confirmed'
  );
  const consumed = confirmed.reduce((sum, consumption) => sum + consumption.total, 0);
  const paid = input.payments
    .filter((payment) => payment.accountId === input.account.id)
    .reduce((sum, payment) => sum + payment.amount, 0);
  const adjustments = input.adjustments
    .filter((adjustment) => adjustment.accountId === input.account.id)
    .reduce((sum, adjustment) => sum + adjustment.amount, 0);
  const unappliedCredit = input.payments
    .filter((payment) => payment.accountId === input.account.id)
    .reduce((sum, payment) => sum + payment.unappliedAmount, 0);
  const users = calculateUserBalances({
    accountId: input.account.id,
    users: input.users,
    consumptions: input.consumptions,
    items: input.items,
    payments: input.payments,
    applications: input.applications,
    adjustments: input.adjustments
  });

  return {
    accountId: input.account.id,
    consumed: round(consumed),
    paid: round(paid),
    adjustments: round(adjustments),
    balance: round(consumed - paid + adjustments),
    unappliedCredit: round(unappliedCredit),
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

    return {
      productId: product.id,
      stock: round(stock),
      stockMin: product.stockMin,
      isLow: stock <= product.stockMin
    };
  });
}

export function itemOpenAmount(
  item: ConsumptionItem,
  consumptions: Consumption[],
  applications: PaymentApplication[]
): number {
  const consumption = consumptions.find((entry) => entry.id === item.consumptionId);
  if (!consumption || consumption.status !== 'confirmed') return 0;
  const paid = applications
    .filter((application) => application.consumptionItemId === item.id)
    .reduce((sum, application) => sum + application.amount, 0);
  return round(Math.max(0, item.total - paid));
}

export function calculateOpenItems(input: {
  accountId: string;
  userId?: string;
  consumptions: Consumption[];
  items: ConsumptionItem[];
  applications: PaymentApplication[];
}): Array<ConsumptionItem & { openAmount: number }> {
  return input.items
    .filter((item) => item.accountId === input.accountId && (!input.userId || item.userId === input.userId))
    .map((item) => ({
      ...item,
      openAmount: itemOpenAmount(item, input.consumptions, input.applications)
    }))
    .filter((item) => item.openAmount > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
