import type { SupabaseClient } from '@supabase/supabase-js';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, LOCAL_DATABASE_NAME } from '../data/db';
import type { AppSession } from '../domain/types';
import { RETRYABLE_CONSUMPTION_MESSAGE, queueOrSubmitConsumption, retryReviewedConsumption, syncPendingConsumptions } from './consumptions';
import { setSupabaseClientForTests } from './sync';

const session: AppSession = {
  key: 'current',
  token: 'session-token',
  role: 'user',
  deviceMode: 'personal',
  userId: '00000000-0000-4000-8000-000000000001',
  userName: 'Papa',
  accountId: '00000000-0000-4000-8000-000000000002',
  accountName: 'Familia',
  expiresAt: '2099-01-01T00:00:00.000Z',
  deviceId: 'device-1',
  createdAt: '2026-07-14T12:00:00.000Z',
  updatedAt: '2026-07-14T12:00:00.000Z'
};

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value
  });
}

describe('outbox de consumos offline', () => {
  beforeEach(async () => {
    db.close();
    await Dexie.delete(LOCAL_DATABASE_NAME);
    await db.open();
    await db.settings.put({ key: 'catalog_version', value: '9' });
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  });

  afterEach(async () => {
    setSupabaseClientForTests(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setOnline(true);
    db.close();
    await Dexie.delete(LOCAL_DATABASE_NAME);
  });

  it('reintenta la misma operacion idempotente y no vuelve a enviarla tras confirmacion', async () => {
    const clientOperationId = '00000000-0000-4000-8000-000000000101';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(clientOperationId);
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'Falla temporal' } })
      .mockResolvedValueOnce({
        data: {
          status: 'confirmed',
          message: 'Compra confirmada.',
          consumption_id: '00000000-0000-4000-8000-000000000201'
        },
        error: null
      });
    setSupabaseClientForTests({ rpc } as unknown as SupabaseClient);

    setOnline(false);
    await expect(
      queueOrSubmitConsumption(session, session.userId, [
        { productId: '00000000-0000-4000-8000-000000000301', quantity: 2 }
      ])
    ).resolves.toMatchObject({ status: 'pending' });

    const queued = await db.pendingConsumptions.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      id: clientOperationId,
      clientOperationId,
      status: 'pending',
      attempts: 0,
      catalogVersion: 9
    });

    setOnline(true);
    await expect(syncPendingConsumptions(session)).resolves.toEqual({ submitted: 0, failed: 1, pending: 1 });
    await expect(db.pendingConsumptions.get(clientOperationId)).resolves.toMatchObject({
      status: 'pending',
      error: RETRYABLE_CONSUMPTION_MESSAGE
    });
    await expect(syncPendingConsumptions(session)).resolves.toEqual({ submitted: 1, failed: 0, pending: 0 });
    await expect(syncPendingConsumptions(session)).resolves.toEqual({ submitted: 0, failed: 0, pending: 0 });

    expect(rpc).toHaveBeenCalledTimes(2);
    for (const [, payload] of rpc.mock.calls) {
      expect(payload).toMatchObject({
        p_session_token: session.token,
        p_client_operation_id: clientOperationId,
        p_device_id: session.deviceId,
        p_catalog_version: 9
      });
    }
    await expect(db.pendingConsumptions.get(clientOperationId)).resolves.toBeUndefined();
  });

  it('conserva la compra pendiente si vence la sesion y la envia tras volver a iniciar', async () => {
    const clientOperationId = '00000000-0000-4000-8000-000000000102';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(clientOperationId);
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'Sesion invalida o expirada.' } })
      .mockResolvedValueOnce({
        data: {
          status: 'confirmed',
          message: 'Compra confirmada.',
          consumption_id: '00000000-0000-4000-8000-000000000202'
        },
        error: null
      });
    setSupabaseClientForTests({ rpc } as unknown as SupabaseClient);
    setOnline(true);

    await expect(
      queueOrSubmitConsumption(session, session.userId, [
        { productId: '00000000-0000-4000-8000-000000000302', quantity: 1 }
      ])
    ).resolves.toMatchObject({ status: 'pending', requiresLogin: true });
    await expect(db.pendingConsumptions.get(clientOperationId)).resolves.toMatchObject({
      status: 'pending',
      clientOperationId
    });

    const renewedSession = { ...session, token: 'renewed-session-token' };
    await expect(syncPendingConsumptions(renewedSession)).resolves.toEqual({ submitted: 1, failed: 0, pending: 0 });
    expect(rpc).toHaveBeenLastCalledWith('create_consumption', expect.objectContaining({
      p_session_token: renewedSession.token,
      p_client_operation_id: clientOperationId
    }));
    await expect(db.pendingConsumptions.get(clientOperationId)).resolves.toBeUndefined();
  });

  it('expone revisión manual y usa el total oficial al reintentar', async () => {
    const clientOperationId = '00000000-0000-4000-8000-000000000103';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(clientOperationId);
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'Producto no disponible: agua' } })
      .mockResolvedValueOnce({
        data: {
          status: 'confirmed',
          message: 'Compra confirmada con el precio oficial vigente.',
          consumption_id: '00000000-0000-4000-8000-000000000203',
          total: '345.50'
        },
        error: null
      });
    setSupabaseClientForTests({ rpc } as unknown as SupabaseClient);
    setOnline(true);

    await expect(
      queueOrSubmitConsumption(session, session.userId, [
        { productId: '00000000-0000-4000-8000-000000000303', quantity: 1 }
      ])
    ).resolves.toMatchObject({ status: 'needs_review' });
    await expect(db.pendingConsumptions.get(clientOperationId)).resolves.toMatchObject({ status: 'needs_review' });

    await expect(retryReviewedConsumption(session, clientOperationId)).resolves.toMatchObject({
      status: 'confirmed',
      officialTotal: 345.5
    });
    await expect(db.pendingConsumptions.get(clientOperationId)).resolves.toBeUndefined();
  });
  it('devuelve a pendiente cuando la llamada de red lanza una excepción', async () => {
    const clientOperationId = '00000000-0000-4000-8000-000000000104';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(clientOperationId);
    const rpc = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        data: {
          status: 'confirmed',
          message: 'Compra confirmada.',
          consumption_id: '00000000-0000-4000-8000-000000000204'
        },
        error: null
      });
    setSupabaseClientForTests({ rpc } as unknown as SupabaseClient);

    setOnline(false);
    await queueOrSubmitConsumption(session, session.userId, [
      { productId: '00000000-0000-4000-8000-000000000304', quantity: 1 }
    ]);

    setOnline(true);
    await expect(syncPendingConsumptions(session)).resolves.toEqual({ submitted: 0, failed: 1, pending: 1 });
    await expect(db.pendingConsumptions.get(clientOperationId)).resolves.toMatchObject({
      status: 'pending',
      error: RETRYABLE_CONSUMPTION_MESSAGE
    });

    await expect(syncPendingConsumptions(session)).resolves.toEqual({ submitted: 1, failed: 0, pending: 0 });
    await expect(db.pendingConsumptions.get(clientOperationId)).resolves.toBeUndefined();
  });
});
