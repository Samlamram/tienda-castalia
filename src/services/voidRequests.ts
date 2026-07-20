import type { AppSession } from '../domain/types';
import { getSupabaseClient, isSyncConfigured } from './sync';

export async function requestConsumptionVoid(
  session: AppSession | undefined,
  consumptionId: string,
  reason: string,
  idempotencyKey: string = crypto.randomUUID()
): Promise<void> {
  if (!isSyncConfigured()) throw new Error('Supabase no esta configurado.');
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Necesitas conexion a internet para solicitar la anulacion.');
  }
  if (!session?.token || session.role !== 'user') throw new Error('Sesion de usuario requerida.');
  if (reason.trim().length < 3) throw new Error('Explica el motivo con al menos 3 caracteres.');

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');
  const { error } = await supabase.rpc('request_consumption_void', {
    p_session_token: session.token,
    p_idempotency_key: idempotencyKey,
    p_consumption_id: consumptionId,
    p_reason: reason.trim()
  });
  if (error) throw new Error(error.message);
}