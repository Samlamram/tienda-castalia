import { beforeEach, describe, expect, it } from 'vitest';
import { calculateAccountBalance, calculateProductStocks } from '../domain/ledger';
import type { Product } from '../domain/types';
import { createId } from '../utils/id';
import { verifyPin } from '../utils/security';
import { db } from './db';
import { ensureSeedData, resetDemoData } from './seed';

async function resetDb() {
  await db.delete();
  await db.open();
}

describe('demo seed data', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('loads a usable local demo with history, payments, stock and images', async () => {
    await resetDemoData();

    const [accounts, users, products, consumptions, items, payments, applications, movements, adjustments, settings] =
      await Promise.all([
        db.accounts.toArray(),
        db.users.toArray(),
        db.products.toArray(),
        db.consumptions.toArray(),
        db.consumptionItems.toArray(),
        db.payments.toArray(),
        db.paymentApplications.toArray(),
        db.inventoryMovements.toArray(),
        db.adjustments.toArray(),
        db.settings.toArray()
      ]);

    const stocks = calculateProductStocks(products, movements);
    const balances = accounts.map((account) =>
      calculateAccountBalance({
        account,
        users,
        consumptions,
        items,
        payments,
        applications,
        adjustments
      })
    );
    const adminPinHash = settings.find((setting) => setting.key === 'admin_pin_hash')?.value;

    expect(accounts.length).toBeGreaterThanOrEqual(4);
    expect(users.length).toBeGreaterThanOrEqual(8);
    expect(products.length).toBeGreaterThanOrEqual(50);
    expect(products.every((product) => product.imageUrl)).toBe(true);
    expect(products.some((product) => product.imageCredit?.includes('Open Food Facts'))).toBe(true);
    expect(consumptions.length).toBeGreaterThanOrEqual(12);
    expect(consumptions.some((consumption) => consumption.status === 'voided')).toBe(true);
    expect(payments.length).toBeGreaterThanOrEqual(5);
    expect(applications.length).toBeGreaterThan(0);
    expect(stocks.some((stock) => stock.isLow)).toBe(true);
    expect(balances.some((balance) => balance.paid > 0)).toBe(true);
    expect(balances.some((balance) => balance.unappliedCredit > 0)).toBe(true);
    expect(adminPinHash && (await verifyPin('0000', adminPinHash))).toBe(true);
  });

  it('does not duplicate the demo catalog when seed runs concurrently', async () => {
    await Promise.all([ensureSeedData(), ensureSeedData()]);

    const products = await db.products.toArray();
    const productNames = products.map((product) => product.name.trim().toLowerCase());

    expect(new Set(productNames).size).toBe(productNames.length);
  });

  it('cleans an existing duplicated demo catalog on the next seed check', async () => {
    await resetDemoData();

    const product = (await db.products.where('name').equals('Agua Cristal 600 ml').first()) as Product;
    await db.products.add({ ...product, id: createId('prd') });
    await db.settings.delete('demo_cleanup_version');

    await ensureSeedData();

    const products = await db.products.toArray();
    const duplicateCount = products.filter((entry) => entry.name === 'Agua Cristal 600 ml').length;
    const productNames = products.map((entry) => entry.name.trim().toLowerCase());

    expect(duplicateCount).toBe(1);
    expect(new Set(productNames).size).toBe(productNames.length);
  });
});
