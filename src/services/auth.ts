import { db } from '../data/db';
import type { AppSession, DeviceMode } from '../domain/types';
import { createId, nowIso } from '../utils/id';
import { hashPin, verifyPin } from '../utils/security';
import { getSupabaseClient, isSyncConfigured } from './sync';

export type LoginOptions = {
  deviceMode: DeviceMode;
};

const PERSONAL_SESSION_DAYS = 90;
const SHARED_SESSION_HOURS = 12;

function sessionExpiry(deviceMode: DeviceMode): string {
  const durationMs =
    deviceMode === 'personal'
      ? PERSONAL_SESSION_DAYS * 24 * 60 * 60 * 1000
      : SHARED_SESSION_HOURS * 60 * 60 * 1000;
  return new Date(Date.now() + durationMs).toISOString();
}

function normalizeDeviceMode(value: unknown): DeviceMode {
  return value === 'personal' ? 'personal' : 'shared';
}

function validatePin(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error('El PIN debe tener entre 4 y 8 digitos.');
  }
}

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}

function online(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export async function ensureDeviceId(): Promise<string> {
  const existing = await db.settings.get('device_id');
  if (existing?.value) return existing.value;
  const deviceId = createId('dev');
  await db.settings.put({ key: 'device_id', value: deviceId });
  return deviceId;
}

function sessionFromRpc(value: unknown, deviceId: string): AppSession {
  const row = value as Record<string, unknown>;
  const timestamp = nowIso();
  const balance = Number(row.balance);
  return {
    key: 'current',
    token: String(row.token ?? ''),
    role: row.role === 'admin' ? 'admin' : 'user',
    deviceMode: normalizeDeviceMode(row.deviceMode ?? row.device_mode),
    userId: String(row.userId ?? row.user_id ?? ''),
    userName: String(row.userName ?? row.user_name ?? ''),
    accountId: row.accountId || row.account_id ? String(row.accountId ?? row.account_id) : undefined,
    accountName: row.accountName || row.account_name ? String(row.accountName ?? row.account_name) : undefined,
    balance: Number.isFinite(balance) ? balance : undefined,
    expiresAt: String(row.expiresAt ?? row.expires_at ?? ''),
    deviceId,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function localLoginPin(username: string, pin: string, deviceMode: DeviceMode): Promise<AppSession> {
  const timestamp = nowIso();
  const deviceId = await ensureDeviceId();
  const normalizedUsername = normalizeLogin(username);

  if (normalizedUsername === 'admin') {
    const setting = await db.settings.get('admin_pin_hash');
    if (!setting || !(await verifyPin(pin, setting.value))) throw new Error('El usuario o el PIN no coinciden.');
    const session: AppSession = {
      key: 'current',
      token: 'local-admin',
      role: 'admin',
      deviceMode,
      userId: 'admin',
      userName: 'Administrador',
      expiresAt: sessionExpiry(deviceMode),
      deviceId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await db.appSessions.put(session);
    return session;
  }

  const users = await db.users.toArray();
  const user = users.find((entry) => entry.status === 'active' && normalizeLogin(entry.name) === normalizedUsername);
  if (!user || !(await verifyPin(pin, user.pinHash))) throw new Error('El usuario o el PIN no coinciden.');
  const account = await db.accounts.get(user.accountId);
  const session: AppSession = {
    key: 'current',
    token: 'local-user',
    role: 'user',
    deviceMode,
    userId: user.id,
    userName: user.name,
    accountId: user.accountId,
    accountName: account?.name,
    expiresAt: sessionExpiry(deviceMode),
    deviceId,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await db.appSessions.put(session);
  return session;
}

export async function loginPin(username: string, pin: string, options: LoginOptions): Promise<AppSession> {
  const deviceMode = normalizeDeviceMode(options.deviceMode);
  if (!isSyncConfigured()) return localLoginPin(username, pin, deviceMode);
  if (!online()) throw new Error('Necesitas conexion para iniciar sesion.');

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');

  const deviceId = await ensureDeviceId();
  const { data, error } = await supabase.rpc('login_pin', {
    p_username: normalizeLogin(username),
    p_pin: pin,
    p_device_id: deviceId,
    p_device_mode: deviceMode
  });

  if (error) throw new Error(error.message);
  const session = sessionFromRpc(data, deviceId);
  if (!session.token || !session.userId) throw new Error('Respuesta de autenticacion invalida.');
  await db.appSessions.put(session);
  return session;
}

export async function getStoredSession(): Promise<AppSession | null> {
  const session = await db.appSessions.get('current');
  if (!session) return null;
  if (session.deviceMode !== 'personal' || (session.expiresAt && session.expiresAt <= nowIso())) {
    await clearStoredSession();
    return null;
  }
  return session;
}

export async function clearStoredSession(): Promise<void> {
  await db.appSessions.delete('current');
}

export async function changeCurrentPin(session: AppSession, currentPin: string, newPin: string): Promise<void> {
  validatePin(newPin);

  if (!isSyncConfigured() || session.token.startsWith('local-')) {
    if (session.role !== 'user') throw new Error('Cambio de PIN disponible solo para usuarios.');
    const user = await db.users.get(session.userId);
    if (!user || !(await verifyPin(currentPin, user.pinHash))) {
      throw new Error('El PIN actual no coincide.');
    }
    await db.users.put({
      ...user,
      pinHash: await hashPin(newPin),
      updatedAt: nowIso()
    });
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');

  const { error } = await supabase.rpc('change_my_pin', {
    p_session_token: session.token,
    p_current_pin: currentPin,
    p_new_pin: newPin
  });

  if (error) throw new Error(error.message);
}
