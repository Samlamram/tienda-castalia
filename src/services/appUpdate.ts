export type ApplyAppUpdate = () => void;

type AppUpdateListener = (applyUpdate: ApplyAppUpdate) => void;

let pendingUpdate: ApplyAppUpdate | null = null;
const listeners = new Set<AppUpdateListener>();

export function publishAppUpdate(applyUpdate: ApplyAppUpdate): void {
  pendingUpdate = applyUpdate;
  listeners.forEach((listener) => listener(applyUpdate));
}

export function subscribeToAppUpdate(listener: AppUpdateListener): () => void {
  listeners.add(listener);
  if (pendingUpdate) listener(pendingUpdate);

  return () => {
    listeners.delete(listener);
  };
}
