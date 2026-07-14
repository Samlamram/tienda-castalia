import { initializeLocalDatabase } from './db';

/**
 * Kept as a compatibility entrypoint for older callers. Demo business data now
 * lives in `supabase/seed.sql`; the browser only initializes its cache/outbox.
 */
export async function ensureSeedData(): Promise<void> {
  await initializeLocalDatabase();
}

export async function resetDemoData(): Promise<void> {
  throw new Error('Los datos demo se restablecen desde supabase/seed.sql.');
}
