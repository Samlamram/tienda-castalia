# Tech stack
- TypeScript 5.9 strict, React 19, Vite 7, ES modules.
- PWA: vite-plugin-pwa/Workbox, auto-update service worker.
- Local offline state: Dexie 4 over IndexedDB; React subscriptions via dexie-react-hooks.
- Backend: Supabase JS 2.89 with PostgreSQL RPC-only client access; schema assembled from ordered SQL migrations.
- Tests: Vitest 4 + Testing Library + jsdom/fake-indexeddb.
- Secondary backup/report UI: Google Apps Script V8 and Google Sheets.
- npm is the package manager (`package-lock.json`).