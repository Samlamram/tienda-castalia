# APP_TIENDA
- Vite/React PWA in `src`; Supabase SQL/RPC source of truth in `supabase`; Google Sheets secondary backup/reporting in `apps-script`.
- Browser data is strictly offline cache/outbox: session, catalog, settings, pending consumptions. Admin snapshots are memory-only.
- Commercial records are immutable; corrections use voids or reversing movements.
- Stack and tooling: `mem:tech_stack`.
- Project-specific coding patterns: `mem:conventions`.
- Completion checks: `mem:task_completion`.
- Useful local commands: `mem:suggested_commands`.