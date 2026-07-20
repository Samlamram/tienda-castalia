import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSession } from '../domain/types';
import { setSupabaseClientForTests } from './sync';
import { requestConsumptionVoid } from './voidRequests';

const userSession: AppSession = {
  key: 'current',
  token: 'session-token',
  role: 'user',
  deviceMode: 'personal',
  userId: '00000000-0000-4000-8000-000000000001',
  userName: 'Samuel',
  expiresAt: '2099-01-01T00:00:00.000Z',
  deviceId: 'device-1',
  createdAt: '2026-07-19T12:00:00.000Z',
  updatedAt: '2026-07-19T12:00:00.000Z'
};

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

describe('solicitudes de anulacion', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    setOnline(true);
  });

  afterEach(() => {
    setSupabaseClientForTests(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setOnline(true);
  });

  it('envia una solicitud idempotente con el motivo normalizado', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'pending' }, error: null });
    setSupabaseClientForTests({ rpc } as unknown as SupabaseClient);

    await requestConsumptionVoid(
      userSession,
      '00000000-0000-4000-8000-000000000010',
      '  Compra registrada por error  ',
      'request-key-1'
    );

    expect(rpc).toHaveBeenCalledWith('request_consumption_void', {
      p_session_token: 'session-token',
      p_idempotency_key: 'request-key-1',
      p_consumption_id: '00000000-0000-4000-8000-000000000010',
      p_reason: 'Compra registrada por error'
    });
  });

  it('no envia motivos demasiado cortos ni solicitudes sin conexion', async () => {
    const rpc = vi.fn();
    setSupabaseClientForTests({ rpc } as unknown as SupabaseClient);

    await expect(requestConsumptionVoid(userSession, 'purchase-1', 'x')).rejects.toThrow('al menos 3 caracteres');
    setOnline(false);
    await expect(requestConsumptionVoid(userSession, 'purchase-1', 'Compra equivocada')).rejects.toThrow('conexion a internet');
    expect(rpc).not.toHaveBeenCalled();
  });
});