import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSession } from './domain/types';

const mocks = vi.hoisted(() => ({
  online: true,
  initializeLocalDatabase: vi.fn(),
  getStoredSession: vi.fn(),
  loginPin: vi.fn(),
  clearStoredSession: vi.fn(),
  changeCurrentPin: vi.fn(),
  refreshCatalog: vi.fn(),
  loadUserAccountActivity: vi.fn(),
  queueOrSubmitConsumption: vi.fn(),
  syncPendingConsumptions: vi.fn(),
  adminRefresh: vi.fn(),
  userData: { users: [] as Array<Record<string, unknown>>, products: [] as Array<Record<string, unknown>> },
  adminState: {
    data: {} as Record<string, unknown>,
    snapshot: { generatedAt: '2026-07-14T12:00:00.000Z' },
    loading: false,
    error: null as string | null
  }
}));

vi.mock('./data/db', () => ({
  initializeLocalDatabase: mocks.initializeLocalDatabase
}));

vi.mock('./hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mocks.online
}));

vi.mock('./hooks/useCloudUserData', () => ({
  useCloudUserData: () => mocks.userData
}));

vi.mock('./hooks/useAdminData', () => ({
  useAdminData: () => ({ ...mocks.adminState, refresh: mocks.adminRefresh })
}));

vi.mock('./services/auth', () => ({
  getStoredSession: mocks.getStoredSession,
  loginPin: mocks.loginPin,
  clearStoredSession: mocks.clearStoredSession,
  changeCurrentPin: mocks.changeCurrentPin
}));

vi.mock('./services/accountActivity', () => ({
  loadUserAccountActivity: mocks.loadUserAccountActivity
}));

vi.mock('./services/catalog', () => ({
  refreshCatalog: mocks.refreshCatalog
}));

vi.mock('./services/consumptions', () => ({
  queueOrSubmitConsumption: mocks.queueOrSubmitConsumption,
  syncPendingConsumptions: mocks.syncPendingConsumptions
}));

vi.mock('./services/sync', () => ({
  isSyncConfigured: () => true
}));

vi.mock('./components/Kiosk', () => ({
  Kiosk: ({ data, sessionUser }: { data: { products?: Array<{ name?: string }> }; sessionUser: { name: string } }) => (
    <section data-testid="kiosk">
      Usuario {sessionUser.name} - {data.products?.[0]?.name ?? 'Sin productos'}
    </section>
  )
}));

vi.mock('./components/AdminPanel', () => ({
  AdminPanel: ({ online }: { online: boolean }) => (
    <section data-testid="admin-panel">Administrador {online ? 'online' : 'offline'}</section>
  )
}));

import { App } from './App';

const timestamp = '2026-07-14T12:00:00.000Z';

function session(overrides: Partial<AppSession>): AppSession {
  return {
    key: 'current',
    token: 'session-token',
    role: 'user',
    deviceMode: 'shared',
    userId: '00000000-0000-4000-8000-000000000001',
    userName: 'Papa',
    accountId: '00000000-0000-4000-8000-000000000002',
    accountName: 'Familia',
    balance: 0,
    expiresAt: '2099-01-01T00:00:00.000Z',
    deviceId: 'device-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value
  });
}

async function submitLogin(username: string, pin: string): Promise<void> {
  fireEvent.change(await screen.findByPlaceholderText('Usuario'), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText(/PIN de acceso/i), { target: { value: pin } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await Promise.resolve();
  });
}

describe('App con Supabase como fuente oficial', () => {
  beforeEach(() => {
    mocks.online = true;
    window.sessionStorage.clear();
    setNavigatorOnline(true);
    mocks.initializeLocalDatabase.mockReset().mockResolvedValue(undefined);
    mocks.getStoredSession.mockReset().mockResolvedValue(null);
    mocks.loginPin.mockReset();
    mocks.clearStoredSession.mockReset().mockResolvedValue(undefined);
    mocks.changeCurrentPin.mockReset().mockResolvedValue(undefined);
    mocks.refreshCatalog.mockReset().mockImplementation(async (value: AppSession) => value);
    mocks.loadUserAccountActivity.mockReset().mockResolvedValue({ generatedAt: timestamp });
    mocks.queueOrSubmitConsumption.mockReset().mockResolvedValue({ status: 'confirmed', message: 'Compra confirmada.' });
    mocks.syncPendingConsumptions.mockReset().mockResolvedValue({ submitted: 0, failed: 0, pending: 0 });
    mocks.adminRefresh.mockReset().mockResolvedValue(undefined);
    mocks.userData = { users: [], products: [] };
    mocks.adminState = {
      data: {},
      snapshot: { generatedAt: '2026-07-14T12:00:00.000Z' },
      loading: false,
      error: null
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
  });

  it('conserva el usuario escrito y mueve el foco al PIN con Enter', async () => {
    const firstRender = render(<App />);
    const username = await screen.findByPlaceholderText('Usuario');
    const password = screen.getByPlaceholderText(/PIN de acceso/i);

    expect(username).toHaveFocus();

    fireEvent.change(username, { target: { value: 'Papa' } });
    fireEvent.keyDown(username, { key: 'Enter', code: 'Enter' });

    expect(password).toHaveFocus();
    expect(window.sessionStorage.getItem('castalia.login.username')).toBe('Papa');

    firstRender.unmount();
    render(<App />);

    expect(await screen.findByPlaceholderText('Usuario')).toHaveValue('Papa');
  });

  it('mantiene el usuario y devuelve el foco al PIN cuando falla el acceso', async () => {
    mocks.loginPin.mockRejectedValue(new Error('Credenciales invalidas.'));
    render(<App />);

    const username = await screen.findByPlaceholderText('Usuario');
    const password = screen.getByPlaceholderText(/PIN de acceso/i);

    fireEvent.change(username, { target: { value: 'Papa' } });
    fireEvent.change(password, { target: { value: '9999' } });
    username.focus();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
      await Promise.resolve();
    });

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.every((alert) => alert.textContent?.includes('Credenciales invalidas.'))).toBe(true);
    expect(password).toHaveFocus();
    expect(username).toHaveValue('Papa');
    expect(window.sessionStorage.getItem('castalia.login.username')).toBe('Papa');
  });

  it('autentica un usuario online, refresca catalogo y abre el kiosco cacheable', async () => {
    const userSession = session({});
    mocks.loginPin.mockResolvedValue(userSession);
    mocks.userData = {
      users: [
        {
          id: userSession.userId,
          accountId: userSession.accountId,
          name: userSession.userName,
          role: 'user',
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1
        }
      ],
      products: [{ name: 'Agua' }]
    };
    render(<App />);

    await submitLogin('  PAPA  ', '1234');

    expect(await screen.findByTestId('kiosk')).toHaveTextContent('Usuario Papa - Agua');
    expect(mocks.loginPin).toHaveBeenCalledWith('papa', '1234', { deviceMode: 'shared' });
    expect(mocks.refreshCatalog).toHaveBeenCalledWith(userSession);
    expect(screen.queryByTestId('admin-panel')).not.toBeInTheDocument();
  });

  it('abre el panel en memoria para un administrador online', async () => {
    const adminSession = session({
      role: 'admin',
      userId: '00000000-0000-4000-8000-000000000099',
      userName: 'Administrador',
      accountId: undefined,
      accountName: undefined,
      balance: undefined,
      deviceMode: 'personal'
    });
    mocks.loginPin.mockResolvedValue(adminSession);
    render(<App />);

    await submitLogin('admin', '0000');

    expect(await screen.findByTestId('admin-panel')).toHaveTextContent('Administrador online');
    expect(mocks.refreshCatalog).not.toHaveBeenCalled();
    expect(screen.queryByTestId('kiosk')).not.toBeInTheDocument();
  });

  it('bloquea datos y mutaciones admin cuando restaura una sesion sin internet', async () => {
    mocks.online = false;
    setNavigatorOnline(false);
    mocks.getStoredSession.mockResolvedValue(
      session({
        role: 'admin',
        userId: '00000000-0000-4000-8000-000000000099',
        userName: 'Administrador',
        accountId: undefined,
        accountName: undefined,
        balance: undefined,
        deviceMode: 'personal'
      })
    );
    render(<App />);

    expect(await screen.findByRole('heading', { name: /administracion sin conexion/i })).toBeInTheDocument();
    expect(screen.getByText(/solo se consultan y modifican con internet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('admin-panel')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.getStoredSession).toHaveBeenCalledOnce());
  });
});
