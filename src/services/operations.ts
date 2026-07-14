/**
 * The former IndexedDB business engine was intentionally retired. All
 * administrative mutations now go through the audited Supabase RPC layer and
 * user purchases use the dedicated offline outbox in `consumptions.ts`.
 */
export {};
