import { useEffect, useState } from 'react';

export const RECONNECT_SETTLE_MS = 2_500;

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    let reconnectTimer: number | undefined;

    const handleOnline = () => {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => setOnline(navigator.onLine), RECONNECT_SETTLE_MS);
    };
    const handleOffline = () => {
      window.clearTimeout(reconnectTimer);
      setOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.clearTimeout(reconnectTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
