import { db } from '../data/db';
import type { AppSession, DeviceMode } from '../domain/types';
import { createId, nowIso } from '../utils/id';
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

export function isSessionAuthenticationError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLocaleLowerCase('es-CO');
  return (
    message.includes('sesion invalida') ||
    message.includes('sesión inválida') ||
    message.includes('sesion expirada') ||
    message.includes('sesión expirada') ||
    message.includes('session expired') ||
    message.includes('invalid session')
  );
}

export async function ensureDeviceId(): Promise<string> {
  const existing = await db.settings.get('device_id');
  if (existing?.value) return existing.value;
  const deviceId = createId('dev');
  await db.settings.put({ key: 'device_id', value: deviceId });
  return deviceId;
}

function sessionFromRpc(
  value: unknown,
  deviceId: string,
  requestedDeviceMode: DeviceMode
): AppSession {
  const row = value as Record<string, unknown>;
  const timestamp = nowIso();
  const balance = Number(row.balance);
  const deviceMode = normalizeDeviceMode(
    row.deviceMode ?? row.device_mode ?? requestedDeviceMode
  );
  return {
    key: 'current',
    token: String(row.token ?? ''),
    role: row.role === 'admin' ? 'admin' : 'user',
    deviceMode,
    userId: String(row.userId ?? row.user_id ?? ''),
    userName: String(row.userName ?? row.user_name ?? ''),
    accountId: row.accountId || row.account_id ? String(row.accountId ?? row.account_id) : undefined,
    accountName: row.accountName || row.account_name ? String(row.accountName ?? row.account_name) : undefined,
    balance: Number.isFinite(balance) ? balance : undefined,
    expiresAt: String(row.expiresAt ?? row.expires_at ?? sessionExpiry(deviceMode)),
    deviceId,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export async function loginPin(username: string, pin: string, options: LoginOptions): Promise<AppSession> {
  const deviceMode = normalizeDeviceMode(options.deviceMode);
  if (!normalizeLogin(username)) throw new Error('Ingresa tu usuario.');
  validatePin(pin);
  if (!isSyncConfigured()) {
    throw new Error('Supabase no esta configurado. No se puede iniciar sesion localmente.');
  }
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
  const response = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (response?.status === 'error' || response?.status === 'blocked') {
    throw new Error(
      typeof response.message === 'string'
        ? response.message
        : response.status === 'blocked'
          ? 'Demasiados intentos. Espera antes de volver a intentar.'
          : 'El usuario o el PIN no coinciden.'
    );
  }
  const session = sessionFromRpc(response ?? data, deviceId, deviceMode);
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

export async function logoutSession(session?: AppSession): Promise<void> {
  try {
    if (!session?.token || !isSyncConfigured() || !online()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.rpc('logout_session', {
      p_session_token: session.token
    });
    if (error) throw new Error(error.message);
  } finally {
    await clearStoredSession();
  }
}

export async function changeCurrentPin(session: AppSession, currentPin: string, newPin: string): Promise<void> {
  validatePin(currentPin);
  validatePin(newPin);
  if (!isSyncConfigured()) throw new Error('Supabase no esta configurado.');
  if (!online()) throw new Error('Necesitas conexion para cambiar el PIN.');

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');

  const { error } = await supabase.rpc('change_my_pin', {
    p_session_token: session.token,
    p_current_pin: currentPin,
    p_new_pin: newPin
  });

  if (error) throw new Error(error.message);
}
