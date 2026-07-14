import { Download, Filter, History, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSession, AuditLogEntry, PersonUser } from '../domain/types';
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

export function AuditHistory({ session, users, onMessage }: AuditHistoryProps) {
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

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
        className="audit-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(draft);
        }}
      >
        <label className="admin-search-field audit-search">
          <Search size={17} />
          <input
            value={draft.search}
            onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
            placeholder="Buscar actor, entidad, motivo o campo"
          />
        </label>
        <select
          aria-label="Filtrar por acción"
          value={draft.action}
          onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
        >
          <option value="">Todas las acciones</option>
          {Object.entries(ACTION_LABELS).map(([action, label]) => <option key={action} value={action}>{label}</option>)}
        </select>
        <select
          aria-label="Filtrar por entidad"
          value={draft.entityType}
          onChange={(event) => setDraft((current) => ({ ...current, entityType: event.target.value }))}
        >
          <option value="">Todas las entidades</option>
          {entityOptions.map((entity) => <option key={entity} value={entity}>{entity}</option>)}
        </select>
        <select
          aria-label="Filtrar por administrador"
          value={draft.actorUserId}
          onChange={(event) => setDraft((current) => ({ ...current, actorUserId: event.target.value }))}
        >
          <option value="">Todos los responsables</option>
          {actorUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
        <label>Desde<input type="date" value={draft.dateFrom} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
        <label>Hasta<input type="date" value={draft.dateTo} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} /></label>
        <button type="submit" className="primary"><Filter size={16} /> Aplicar</button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setDraft(EMPTY_FILTERS);
            setFilters(EMPTY_FILTERS);
          }}
        >
          Limpiar
        </button>
      </form>

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
