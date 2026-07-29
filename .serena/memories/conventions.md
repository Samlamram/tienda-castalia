# Conventions
- Supabase is authoritative; never turn IndexedDB into a second business-data source.
- Admin views require internet and keep snapshots only in React memory. User mode may use cached catalog/session and queued purchases offline.
- Backend client operations use app-specific Supabase RPCs; direct table privileges are revoked/RLS-protected.
- Persisted commercial data is append-only in effect: archive/status changes, voids, and reversal movements replace physical deletion.
- TypeScript uses strict types, functional React components/hooks, async service functions, and domain mapping helpers at API boundaries.
- UI text is Spanish. Tests describe behavior in Spanish and colocate as `*.test.ts(x)`.
- `supabase/schema.sql` must remain the exact ordered concatenation asserted by `src/supabase-schema.test.ts` when migrations change.