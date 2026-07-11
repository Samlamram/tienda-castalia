import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { isSyncConfigured, syncNow } from '../services/sync';

interface StatusBarProps {
  online: boolean;
  pendingSync: number;
  onMessage: (message: string) => void;
}

export function StatusBar({ online, pendingSync, onMessage }: StatusBarProps) {
  async function handleSync() {
    try {
      const result = await syncNow();
      onMessage(`Sincronizacion: ${result.pushed} enviados, ${result.pulled} recibidos.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'No se pudo sincronizar.');
    }
  }

  return (
    <div className="status-bar">
      <div className={online ? 'status-pill ok' : 'status-pill warn'}>
        {online ? <Cloud size={16} /> : <CloudOff size={16} />}
        {online ? 'Online' : 'Offline'}
      </div>
      <div className={pendingSync > 0 ? 'status-pill warn' : 'status-pill ok'}>
        {pendingSync} pendiente{pendingSync === 1 ? '' : 's'}
      </div>
      <button className="ghost small" onClick={handleSync} disabled={!online || !isSyncConfigured()}>
        <RefreshCw size={16} />
        Sincronizar
      </button>
      {!isSyncConfigured() ? <span className="muted">Supabase no configurado</span> : null}
    </div>
  );
}
