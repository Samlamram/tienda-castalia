import type { SupabaseClient } from '@supabase/supabase-js';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, LOCAL_DATABASE_NAME } from '../data/db';
import { changeCurrentPin, getStoredSession, loginPin } from './auth';
import { setSupabaseClientForTests } from './sync';

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value
  });
}

function rpcClient(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe('autenticacion remota y politica de sesiones', () => {
  beforeEach(async () => {
    db.close();
    await Dexie.delete(LOCAL_DATABASE_NAME);
    await db.open();
    setOnline(true);
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  });

  afterEach(async () => {
    setSupabaseClientForTests(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    db.close();
    await Dexie.delete(LOCAL_DATABASE_NAME);
  });

  it('normaliza el usuario, inicia sesion por RPC y restaura una sesion personal', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        token: 'session-token',
        role: 'user',
        user_id: '00000000-0000-4000-8000-000000000001',
        user_name: 'Papa',
        account_id: '00000000-0000-4000-8000-000000000002',
        account_name: 'Familia',
        balance: '125.50',
        expires_at: '2099-01-01T00:00:00.000Z'
      },
      error: null
    });
    setSupabaseClientForTests(rpcClient(rpc));

    const session = await loginPin('  PAPA  ', '1234', { deviceMode: 'personal' });

    expect(rpc).toHaveBeenCalledWith(
      'login_pin',
      expect.objectContaining({
        p_username: 'papa',
        p_pin: '1234',
        p_device_mode: 'personal'
      })
    );
    expect(session).toMatchObject({
      token: 'session-token',
      userName: 'Papa',
      deviceMode: 'personal',
      balance: 125.5
    });
    await expect(getStoredSession()).resolves.toMatchObject({ token: 'session-token' });
  });

  it('borra una sesion compartida en lugar de restaurarla', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        token: 'shared-token',
        role: 'user',
        userId: '00000000-0000-4000-8000-000000000001',
        userName: 'Usuario',
        deviceMode: 'shared',
        expiresAt: '2099-01-01T00:00:00.000Z'
      },
      error: null
    });
    setSupabaseClientForTests(rpcClient(rpc));

    await loginPin('usuario', '1234', { deviceMode: 'shared' });

    await expect(getStoredSession()).resolves.toBeNull();
    await expect(db.appSessions.get('current')).resolves.toBeUndefined();
  });

  it('cambia el PIN exclusivamente mediante RPC y nunca escribe usuarios locales', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'ok' }, error: null });
    setSupabaseClientForTests(rpcClient(rpc));
    const session = {
      key: 'current' as const,
      token: 'session-token',
      role: 'user' as const,
      deviceMode: 'personal' as const,
      userId: '00000000-0000-4000-8000-000000000001',
      userName: 'Usuario',
      expiresAt: '2099-01-01T00:00:00.000Z',
      deviceId: 'device-1',
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: '2026-07-14T12:00:00.000Z'
    };

    await changeCurrentPin(session, '1234', '9876');

    expect(rpc).toHaveBeenCalledWith('change_my_pin', {
      p_session_token: 'session-token',
      p_current_pin: '1234',
      p_new_pin: '9876'
    });
    expect(db.tables.map((table) => table.name)).not.toContain('users');
  });

  it('rechaza login sin conexion antes de invocar Supabase', async () => {
    const rpc = vi.fn();
    setSupabaseClientForTests(rpcClient(rpc));
    setOnline(false);

    await expect(loginPin('usuario', '1234', { deviceMode: 'personal' })).rejects.toThrow(/conexion/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});
