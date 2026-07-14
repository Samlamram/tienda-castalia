import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import type { AdminSnapshot, AppSession } from '../domain/types';
import { adminSnapshotToViewData, EMPTY_ADMIN_SNAPSHOT } from '../domain/viewData';
import { loadAdminSnapshot } from '../services/adminApi';

export function useAdminData(session: AppSession | null | undefined, online: boolean) {
  const settings = useLiveQuery(() => db.settings.toArray(), [], []);
  const [snapshot, setSnapshot] = useState<AdminSnapshot>(EMPTY_ADMIN_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (!session || session.role !== 'admin') throw new Error('Sesion de administrador requerida.');
    if (!online) throw new Error('La administracion requiere conexion a internet.');

    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setError(null);

    try {
      const next = await loadAdminSnapshot(session);
      if (requestVersion.current === version) setSnapshot(next);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudieron cargar los datos administrativos.';
      if (requestVersion.current === version) setError(message);
      throw cause;
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [online, session]);

  useEffect(() => {
    if (!session || session.role !== 'admin' || !online) {
      requestVersion.current += 1;
      setSnapshot(EMPTY_ADMIN_SNAPSHOT);
      setLoading(false);
      setError(null);
      return;
    }

    void refresh().catch(() => undefined);
    return () => {
      requestVersion.current += 1;
    };
  }, [online, refresh, session]);

  const data = useMemo(() => adminSnapshotToViewData(snapshot, settings), [settings, snapshot]);
  return { data, snapshot, loading, error, refresh };
}
