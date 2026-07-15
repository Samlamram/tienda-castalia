import { Download, Filter, History, Search, SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AppSession, AuditLogEntry, PersonUser } from '../domain/types';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { loadAllAuditLog, loadAuditLog } from '../services/adminApi';

interface AuditHistoryProps {
  session?: AppSession;
  users: PersonUser[];
  onMessage: (message: string) => void;
}

interface AuditFilters {
  search: string;
  action: string;
  entityType: string;
  actorUserId: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: AuditFilters = {
  search: '',
  action: '',
  entityType: '',
  actorUserId: '',
  dateFrom: '',
  dateTo: ''
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Creado',
  update: 'Editado',
  delete: 'Eliminado',
  archive: 'Archivado',
  restore: 'Restaurado',
  void: 'Anulado',
  reverse: 'Reversado',
  command: 'Operación administrativa',
  login_failed: 'Inicio fallido',
  login_rejected: 'Inicio rechazado',
  logout: 'Cierre de sesión',
  pin_changed: 'PIN cambiado'
};

const AUDITED_ENTITIES = [
  'accounts',
  'app_users',
  'app_sessions',
  'products',
  'consumptions',
  'consumption_items',
  'financial_movements',
  'payment_applications',
  'inventory_movements',
  'fifo_cost_allocations',
  'authentication',
  'admin_command'
] as const;

function localDateBoundaryIso(value: string, endOfDay = false): string {
  const boundary = new Date(`${value}T00:00:00.000`);
  if (endOfDay) boundary.setDate(boundary.getDate() + 1);
  return boundary.toISOString();
}

function csvValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const spreadsheetSafe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
}

function saveAuditCsv(entries: AuditLogEntry[]): void {
  const header = [
    'fecha',
    'actor',
    'accion',
    'entidad',
    'registro',
    'campos',
    'motivo',
    'antes',
    'despues',
    'request_id',
    'device_id'
  ];
  const rows = entries.map((entry) => [
    entry.createdAt,
    entry.actorName ?? entry.actorUserId ?? 'Sistema',
    entry.action,
    entry.entityType,
    entry.recordId ?? '',
    entry.changedFields.join(', '),
    entry.reason ?? '',
    entry.beforeData ?? {},
    entry.afterData ?? {},
    entry.requestId,
    entry.deviceId ?? ''
  ]);
  const csv = [header, ...rows].map((line) => line.map(csvValue).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function trapFocusWithin(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function AuditHistory({ session, users, onMessage }: AuditHistoryProps) {
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const requestVersion = useRef(0);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filterCloseRef = useRef<HTMLButtonElement | null>(null);
  const filterSheetId = useId();
  const filterSheetHeadingId = useId();

  useBodyScrollLock(filterSheetOpen);

  useEffect(() => {
    if (!filterSheetOpen) return;

    const focusFrame = window.requestAnimationFrame(() => filterCloseRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFilterSheetOpen(false);
      window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [filterSheetOpen]);

  const loadPage = useCallback(
    async (nextPage: number, append: boolean): Promise<void> => {
      if (!session) return;
      const request = requestVersion.current + 1;
      requestVersion.current = request;
      setLoading(true);
      setError(null);
      try {
        const normalizedFilters = {
          ...filters,
          dateFrom: filters.dateFrom ? localDateBoundaryIso(filters.dateFrom) : undefined,
          dateTo: filters.dateTo ? localDateBoundaryIso(filters.dateTo, true) : undefined
        };
        const result = await loadAuditLog(session, {
          ...normalizedFilters,
          page: nextPage,
          limit: 50
        });
        if (requestVersion.current !== request) return;
        setEntries((current) => (append ? [...current, ...result.entries] : result.entries));
        setPage(result.page);
        setTotal(result.total);
      } catch (cause) {
        if (requestVersion.current !== request) return;
        const message = cause instanceof Error ? cause.message : 'No se pudo consultar la auditoria.';
        setError(message);
        onMessage(message);
      } finally {
        if (requestVersion.current === request) setLoading(false);
      }
    },
    [filters, onMessage, session]
  );

  useEffect(() => {
    void loadPage(1, false);
    return () => {
      requestVersion.current += 1;
    };
  }, [loadPage]);

  const entityOptions = useMemo(
    () => Array.from(new Set([...AUDITED_ENTITIES, ...entries.map((entry) => entry.entityType)])).sort(),
    [entries]
  );
  const actorUsers = [...users].sort((left, right) => left.name.localeCompare(right.name, 'es'));
  const hasMore = page * 50 < total;
  const advancedFilterCount = [draft.action, draft.entityType, draft.actorUserId, draft.dateFrom, draft.dateTo]
    .filter(Boolean).length;

  function closeFilterSheet(restoreFocus = true): void {
    setFilterSheetOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
    }
  }

  function applyDraftFilters(): void {
    setFilters(draft);
  }

  function clearAllFilters(): void {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  }

  function clearSearch(): void {
    setDraft((current) => ({ ...current, search: '' }));
    setFilters((current) => ({ ...current, search: '' }));
  }

  async function exportAudit(): Promise<void> {
    if (!session) return;
    setExporting(true);
    try {
      const completeHistory = await loadAllAuditLog(session, {
        ...filters,
        dateFrom: filters.dateFrom ? localDateBoundaryIso(filters.dateFrom) : undefined,
        dateTo: filters.dateTo ? localDateBoundaryIso(filters.dateTo, true) : undefined
      });
      saveAuditCsv(completeHistory);
      onMessage(`${completeHistory.length} cambio${completeHistory.length === 1 ? '' : 's'} exportado${completeHistory.length === 1 ? '' : 's'}.`);
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : 'No se pudo exportar la auditoría.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="audit-panel" aria-labelledby="audit-title">
      <header className="audit-heading">
        <span className="audit-heading-icon" aria-hidden="true"><History size={22} /></span>
        <div>
          <h2 id="audit-title">Historial de cambios</h2>
          <p>Consulta quién cambió cada registro y compara el valor anterior con el nuevo.</p>
        </div>
        <button
          type="button"
          className="ghost small"
          onClick={() => void exportAudit()}
          disabled={total === 0 || exporting}
        >
          <Download size={16} /> {exporting ? 'Exportando...' : 'Exportar CSV'}
        </button>
      </header>

      <form
        className="audit-filters audit-filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          applyDraftFilters();
        }}
      >
        <div className="admin-search-field audit-search audit-filter-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={draft.search}
            onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
            placeholder="Buscar actor, entidad, motivo o campo"
            aria-label="Buscar en el historial"
          />
          {draft.search ? (
            <button
              type="button"
              className="audit-filter-search-clear"
              onClick={clearSearch}
              aria-label="Limpiar búsqueda"
            >
              <X size={17} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <select
          className="audit-filter-desktop audit-filter-action"
          aria-label="Filtrar por acción"
          value={draft.action}
          onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
        >
          <option value="">Todas las acciones</option>
          {Object.entries(ACTION_LABELS).map(([action, label]) => <option key={action} value={action}>{label}</option>)}
        </select>
        <select
          className="audit-filter-desktop audit-filter-entity"
          aria-label="Filtrar por entidad"
          value={draft.entityType}
          onChange={(event) => setDraft((current) => ({ ...current, entityType: event.target.value }))}
        >
          <option value="">Todas las entidades</option>
          {entityOptions.map((entity) => <option key={entity} value={entity}>{entity}</option>)}
        </select>
        <select
          className="audit-filter-desktop audit-filter-actor"
          aria-label="Filtrar por administrador"
          value={draft.actorUserId}
          onChange={(event) => setDraft((current) => ({ ...current, actorUserId: event.target.value }))}
        >
          <option value="">Todos los responsables</option>
          {actorUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
        <label className="audit-filter-desktop audit-filter-date">Desde<input type="date" value={draft.dateFrom} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
        <label className="audit-filter-desktop audit-filter-date">Hasta<input type="date" value={draft.dateTo} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} /></label>
        <button type="submit" className="primary audit-filter-desktop audit-filter-apply"><Filter size={16} /> Aplicar</button>
        <button
          type="button"
          className="ghost audit-filter-desktop audit-filter-clear"
          onClick={clearAllFilters}
        >
          Limpiar
        </button>
        <button
          ref={filterTriggerRef}
          type="button"
          className="ghost audit-filter-trigger"
          onClick={() => setFilterSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={filterSheetOpen}
          aria-controls={filterSheetId}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          Filtros
          {advancedFilterCount > 0 ? <span className="audit-filter-count">{advancedFilterCount}</span> : null}
        </button>
      </form>

      {filterSheetOpen ? (
        <div
          className="filter-sheet-backdrop audit-filter-sheet-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeFilterSheet();
          }}
        >
          <form
            id={filterSheetId}
            className="filter-sheet audit-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={filterSheetHeadingId}
            onKeyDown={trapFocusWithin}
            onSubmit={(event) => {
              event.preventDefault();
              applyDraftFilters();
              closeFilterSheet();
            }}
          >
            <header className="filter-sheet-header">
              <div>
                <span>Historial</span>
                <h2 id={filterSheetHeadingId}>Filtros avanzados</h2>
              </div>
              <button
                ref={filterCloseRef}
                type="button"
                className="filter-sheet-close"
                onClick={() => closeFilterSheet()}
                aria-label="Cerrar filtros"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="audit-filter-sheet-fields">
              <label>
                Acción
                <select
                  value={draft.action}
                  onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
                >
                  <option value="">Todas las acciones</option>
                  {Object.entries(ACTION_LABELS).map(([action, label]) => <option key={action} value={action}>{label}</option>)}
                </select>
              </label>
              <label>
                Entidad
                <select
                  value={draft.entityType}
                  onChange={(event) => setDraft((current) => ({ ...current, entityType: event.target.value }))}
                >
                  <option value="">Todas las entidades</option>
                  {entityOptions.map((entity) => <option key={entity} value={entity}>{entity}</option>)}
                </select>
              </label>
              <label>
                Responsable
                <select
                  value={draft.actorUserId}
                  onChange={(event) => setDraft((current) => ({ ...current, actorUserId: event.target.value }))}
                >
                  <option value="">Todos los responsables</option>
                  {actorUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </label>
              <div className="audit-filter-sheet-dates">
                <label>Desde<input type="date" value={draft.dateFrom} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
                <label>Hasta<input type="date" value={draft.dateTo} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} /></label>
              </div>
            </div>

            <footer className="audit-filter-sheet-actions">
              <button type="button" className="ghost" onClick={() => {
                clearAllFilters();
                closeFilterSheet();
              }}>
                Limpiar
              </button>
              <button type="submit" className="primary"><Filter size={16} aria-hidden="true" /> Aplicar filtros</button>
            </footer>
          </form>
        </div>
      ) : null}

      {error ? <p className="login-error-message">{error}</p> : null}
      <div className="audit-list" aria-live="polite">
        {entries.map((entry) => (
          <details className="audit-entry" key={entry.id}>
            <summary>
              <span className={`audit-action audit-${entry.action}`}>{ACTION_LABELS[entry.action] ?? entry.action}</span>
              <span className="audit-entry-main">
                <strong>{entry.entityType}{entry.recordId ? ` · ${entry.recordId.slice(0, 8)}` : ''}</strong>
                <small>{entry.actorName ?? 'Sistema'} · {new Date(entry.createdAt).toLocaleString('es-CO')}</small>
              </span>
              <span className="audit-fields">{entry.changedFields.length > 0 ? entry.changedFields.join(', ') : 'registro completo'}</span>
            </summary>
            <div className="audit-entry-detail">
              {entry.reason ? <p><strong>Motivo:</strong> {entry.reason}</p> : null}
              <div className="audit-comparison">
                <section><h3>Antes</h3><pre>{JSON.stringify(entry.beforeData ?? {}, null, 2)}</pre></section>
                <section><h3>Después</h3><pre>{JSON.stringify(entry.afterData ?? {}, null, 2)}</pre></section>
              </div>
              <small>Solicitud {entry.requestId} · Dispositivo {entry.deviceId ?? 'no informado'}</small>
            </div>
          </details>
        ))}
        {!loading && entries.length === 0 ? <p className="admin-empty-state">No hay cambios para estos filtros.</p> : null}
      </div>
      {loading ? <p className="muted">Cargando historial...</p> : null}
      {hasMore ? (
        <button type="button" className="ghost audit-load-more" disabled={loading} onClick={() => void loadPage(page + 1, true)}>
          Cargar más ({entries.length} de {total})
        </button>
      ) : null}
    </section>
  );
}
