import type { AdminSnapshot, AppSession } from '../domain/types';
import { mapAdminSnapshot } from './adminApi';
import { getSupabaseClient, isSyncConfigured } from './sync';

export async function loadUserAccountActivity(session: AppSession): Promise<AdminSnapshot> {
  if (!isSyncConfigured()) throw new Error('Supabase no esta configurado.');
  if (session.role !== 'user') throw new Error('La actividad de cuenta requiere una sesion de usuario.');

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');

  const { data, error } = await supabase.rpc('get_user_account_activity', {
    p_session_token: session.token,
    p_limit: 50
  });

  if (error) throw new Error(error.message);
  return mapAdminSnapshot(data);
}
