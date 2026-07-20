import type { AdminSnapshot, AppSession } from '../domain/types';
import { mapAdminSnapshot, mapConsumptionVoidRequest } from './adminApi';
import { getSupabaseClient, isSyncConfigured } from './sync';

export async function loadUserAccountActivity(session: AppSession): Promise<AdminSnapshot> {
  if (!isSyncConfigured()) throw new Error('Supabase no esta configurado.');
  if (session.role !== 'user') throw new Error('La actividad de cuenta requiere una sesion de usuario.');

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');

  const [{ data, error }, voidRequestsResult] = await Promise.all([
    supabase.rpc('get_user_account_activity', {
      p_session_token: session.token,
      p_limit: 50
    }),
    supabase.rpc('get_consumption_void_requests', { p_session_token: session.token })
  ]);

  if (error) throw new Error(error.message);
  const snapshot = mapAdminSnapshot(data);
  const requestPayload = voidRequestsResult.data as { items?: unknown[] } | null;
  return {
    ...snapshot,
    consumptionVoidRequests: voidRequestsResult.error
      ? []
      : (requestPayload?.items ?? []).map(mapConsumptionVoidRequest)
  };
}
