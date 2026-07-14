import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  db,
  initializeLocalDatabase,
  LEGACY_LOCAL_DATABASE_NAME,
  LOCAL_DATABASE_NAME
} from './db';

describe('base local v2', () => {
  beforeEach(async () => {
    db.close();
    await Dexie.delete(LOCAL_DATABASE_NAME);
    await Dexie.delete(LEGACY_LOCAL_DATABASE_NAME);
  });

  afterEach(async () => {
    db.close();
    await Dexie.delete(LOCAL_DATABASE_NAME);
    await Dexie.delete(LEGACY_LOCAL_DATABASE_NAME);
  });

  it('expone exactamente los cuatro stores permitidos', async () => {
    await db.open();

    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'appSessions',
      'catalogProducts',
      'pendingConsumptions',
      'settings'
    ]);
  });

  it('abre v2 antes de retirar de forma idempotente la base demo v1', async () => {
    const legacy = new Dexie(LEGACY_LOCAL_DATABASE_NAME);
    legacy.version(1).stores({ products: 'id' });
    await legacy.open();
    await legacy.table('products').put({ id: 'legacy-product' });
    legacy.close();

    await initializeLocalDatabase();
    await initializeLocalDatabase();

    expect(db.isOpen()).toBe(true);
    expect(await Dexie.exists(LEGACY_LOCAL_DATABASE_NAME)).toBe(false);
    await expect(db.settings.get('legacy_v1_removed')).resolves.toEqual({
      key: 'legacy_v1_removed',
      value: 'true'
    });
  });

  it('impide dos filas de outbox con el mismo clientOperationId', async () => {
    await db.open();
    const pending = {
      id: '00000000-0000-4000-8000-000000000001',
      clientOperationId: '00000000-0000-4000-8000-000000000101',
      sessionUserId: '00000000-0000-4000-8000-000000000201',
      deviceId: 'device-1',
      catalogVersion: 1,
      items: [{ productId: '00000000-0000-4000-8000-000000000301', quantity: 1 }],
      status: 'pending' as const,
      attempts: 0,
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: '2026-07-14T12:00:00.000Z'
    };

    await db.pendingConsumptions.add(pending);

    await expect(
      db.pendingConsumptions.add({
        ...pending,
        id: '00000000-0000-4000-8000-000000000002'
      })
    ).rejects.toMatchObject({ name: 'ConstraintError' });
    await expect(db.pendingConsumptions.count()).resolves.toBe(1);
  });
});
