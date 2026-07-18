import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminPanel } from './components/AdminPanel';
import { AppToast } from './components/AppToast';
import { BrandLogo } from './components/BrandLogo';
import { Kiosk } from './components/Kiosk';
import { LoadingExperience } from './components/LoadingExperience';
import { initializeLocalDatabase } from './data/db';
import type { AdminSnapshot, AppSession } from './domain/types';
import { useAdminData } from './hooks/useAdminData';
import { useCloudUserData } from './hooks/useCloudUserData';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  changeCurrentPin,
  getStoredSession,
  isSessionAuthenticationError,
  loginPin,
  logoutSession
} from './services/auth';
import { loadUserAccountActivity } from './services/accountActivity';
import { refreshCatalog } from './services/catalog';
import { requestPersistentLocalStorage } from './services/imageCache';
import {
  discardReviewedConsumption,
  queueOrSubmitConsumption,
  retryReviewedConsumption,
  syncPendingConsumptions
} from './services/consumptions';
import { isSyncConfigured } from './services/sync';

type AuthSession =
  | { role: 'admin'; cloudSession?: AppSession }
  | { role: 'user'; userId: string; cloudSession?: AppSession };

function authSessionFromAppSession(session: AppSession): AuthSession {
  return session.role === 'admin'
    ? { role: 'admin', cloudSession: session }
    : { role: 'user', userId: session.userId, cloudSession: session };
}

export function App() {
  const online = useOnlineStatus();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);
  const [message, setMessage] = useState('');
  const [userActivityRefreshVersion, setUserActivityRefreshVersion] = useState(0);
  const [userActivityState, setUserActivityState] = useState<{
    token: string;
    snapshot: AdminSnapshot;
  } | null>(null);
  const userSession = session?.role === 'user' ? session.cloudSession : null;
  const userActivity = userActivityState && userSession?.token === userActivityState.token
    ? userActivityState.snapshot
    : null;
  const cloudUserData = useCloudUserData(userSession, userActivity);
  const adminData = useAdminData(session?.role === 'admin' ? session.cloudSession : null, online);
  const logout = useCallback(() => {
    const cloudSession = sessionRef.current?.cloudSession;
    setUserActivityState(null);
    setSession(null);
    void logoutSession(cloudSession).catch(() => undefined);
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const activeSession = session?.role === 'user' ? session.cloudSession : null;
    if (!activeSession) {
      setUserActivityState(null);
      return;
    }
    if (!online || !isSyncConfigured()) return;

    let cancelled = false;
    loadUserAccountActivity(activeSession)
      .then((snapshot) => {
        if (!cancelled) setUserActivityState({ token: activeSession.token, snapshot });
      })
      .catch((error) => {
        if (cancelled) return;
        if (isSessionAuthenticationError(error)) {
          setMessage('Tu sesión ya no es válida. Inicia sesión nuevamente.');
          logout();
          return;
        }
        setMessage(
          error instanceof Error
            ? `No se pudo actualizar tu historial: ${error.message}`
            : 'No se pudo actualizar tu historial.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [logout, online, session?.cloudSession, session?.role, userActivityRefreshVersion]);

  // Update the status-bar / theme-color to match the current screen
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
      meta.content = session ? '#f2f5f1' : '#052319';
    }
  }, [session]);


  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        await initializeLocalDatabase();
        void requestPersistentLocalStorage();
        const stored = await getStoredSession();
        if (!stored) return;
        let current = stored;

        if (navigator.onLine && stored.role === 'user') {
          try {
            current = await refreshCatalog(stored);
          } catch (error) {
            if (isSessionAuthenticationError(error)) {
              await logoutSession(stored).catch(() => undefined);
              if (!cancelled) setMessage('Tu sesión ya no es válida. Inicia sesión nuevamente.');
              return;
            }
            if (!cancelled) {
              setMessage(
                error instanceof Error
                  ? `Se usará el catálogo guardado: ${error.message}`
                  : 'Se usará el catálogo guardado.'
              );
            }
          }
        }

        if (!cancelled) {
          setSession(authSessionFromAppSession(current));
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No se pudo inicializar.');
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!online || !isSyncConfigured() || session?.role !== 'user' || !session.cloudSession) return;
    const userSession = session.cloudSession;

    const run = async () => {
      try {
        const result = await syncPendingConsumptions(userSession);
        if (result.requiresLogin) {
          setMessage('Tu sesión expiró. La compra quedó guardada para revisarla al volver a iniciar sesión.');
          logout();
          return;
        }
        await refreshCatalog(userSession);
        setUserActivityRefreshVersion((current) => current + 1);
        if (result.submitted > 0) {
          setMessage(
            `${result.submitted} compra${result.submitted === 1 ? '' : 's'} pendiente${
              result.submitted === 1 ? '' : 's'
            } sincronizada${result.submitted === 1 ? '' : 's'}.`
          );
          if (userSession.deviceMode === 'shared') {
            logout();
          }
        }
      } catch (error) {
        if (isSessionAuthenticationError(error)) {
          setMessage('Tu sesión ya no es válida. Inicia sesión nuevamente.');
          logout();
          return;
        }
        setMessage(error instanceof Error ? error.message : 'Sincronizacion fallida.');
      }
    };

    run();
    const interval = window.setInterval(run, 30_000);
    return () => window.clearInterval(interval);
  }, [logout, online, session]);

  useEffect(() => {
    if (session?.role !== 'admin' || !adminData.error || !isSessionAuthenticationError(adminData.error)) return;
    setMessage('Tu sesión administrativa ya no es válida. Inicia sesión nuevamente.');
    logout();
  }, [adminData.error, logout, session?.role]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const activeData = cloudUserData;
  const loggedUser = session?.role === 'user' ? activeData.users.find((user) => user.id === session.userId) : undefined;

  async function handleAuthenticatedSession(nextSession: AppSession) {
    let current = nextSession;
    if (online && nextSession.role === 'user') {
      try {
        current = await refreshCatalog(nextSession);
      } catch (error) {
        if (isSessionAuthenticationError(error)) {
          setMessage('Tu sesión ya no es válida. Inicia sesión nuevamente.');
          await logoutSession(nextSession).catch(() => undefined);
          return;
        }
        setMessage(
          error instanceof Error
            ? `Sesión iniciada; se usará el catálogo guardado: ${error.message}`
            : 'Sesión iniciada; se usará el catálogo guardado.'
        );
      }
    }
    setSession(authSessionFromAppSession(current));
  }

  async function handleChangePin(currentPin: string, newPin: string) {
    if (!session?.cloudSession) {
      throw new Error('No hay una sesion activa.');
    }
    await changeCurrentPin(session.cloudSession, currentPin, newPin);
  }

  async function handleConfirmConsumption(userId: string, cart: Parameters<typeof queueOrSubmitConsumption>[2]) {
    const userSession = session?.role === 'user' ? session.cloudSession : undefined;
    const result = await queueOrSubmitConsumption(userSession, userId, cart);

    if (result.requiresLogin) {
      logout();
      return result;
    }

    if (online && userSession && result.status !== 'pending') {
      try {
        const refreshed = await refreshCatalog(userSession);
        setSession(authSessionFromAppSession(refreshed));
        setUserActivityRefreshVersion((current) => current + 1);
      } catch (error) {
        if (isSessionAuthenticationError(error)) {
          setMessage('La compra quedó guardada, pero tu sesión venció. Inicia sesión nuevamente.');
          logout();
          return result;
        }
        setMessage(
          error instanceof Error
            ? `Compra guardada; el saldo se actualizará después: ${error.message}`
            : 'Compra guardada; el saldo se actualizará después.'
        );
      }
    }

    return result;
  }

  async function handleRetryPendingConsumption(pendingId: string) {
    const userSession = session?.role === 'user' ? session.cloudSession : undefined;
    const result = await retryReviewedConsumption(userSession, pendingId);
    if (result.requiresLogin) {
      logout();
      return result;
    }
    if (result.status === 'confirmed' && userSession) {
      try {
        const refreshed = await refreshCatalog(userSession);
        setSession(authSessionFromAppSession(refreshed));
        setUserActivityRefreshVersion((current) => current + 1);
      } catch (error) {
        if (isSessionAuthenticationError(error)) {
          setMessage('La compra se confirmó, pero tu sesión venció. Inicia sesión nuevamente.');
          logout();
          return result;
        }
        setMessage(
          error instanceof Error
            ? `Compra confirmada; el saldo se actualizará después: ${error.message}`
            : 'Compra confirmada; el saldo se actualizará después.'
        );
      }
    }
    return result;
  }

  async function handleDiscardPendingConsumption(pendingId: string) {
    if (session?.role !== 'user') throw new Error('No hay una sesión de usuario activa.');
    await discardReviewedConsumption(session.userId, pendingId);
  }

  if (!ready) {
    return (
      <LoadingExperience
        label="Preparando tu tienda"
        detail="Cargando el catalogo y tus preferencias."
        variant="brand"
      />
    );
  }

  return (
    <main
      className={
        session?.role === 'user' ? 'app-shell user-shell' : session?.role === 'admin' ? 'app-shell admin-shell' : 'app-shell'
      }
    >
      {message ? <AppToast message={message} onClose={() => setMessage('')} /> : null}

      {!session ? <LoginScreen onLogin={handleAuthenticatedSession} onMessage={setMessage} /> : null}

      {session?.role === 'user' && loggedUser ? (
        <Kiosk
          data={activeData}
          onMessage={setMessage}
          sessionUser={loggedUser}
          onLogout={logout}
          isSharedDevice={session.cloudSession?.deviceMode !== 'personal'}
          onChangePin={handleChangePin}
          onConfirmConsumption={handleConfirmConsumption}
          onRetryPendingConsumption={handleRetryPendingConsumption}
          onDiscardPendingConsumption={handleDiscardPendingConsumption}
        />
      ) : null}

      {session?.role === 'admin' ? (
        !online ? (
          <AdminConnectionGate onLogout={logout} />
        ) : adminData.loading && !adminData.snapshot.generatedAt ? (
          <LoadingExperience
            label="Cargando administracion"
            detail="Sincronizando productos, cuentas y finanzas."
            variant="surface"
            skeleton
          />
        ) : adminData.error && !adminData.snapshot.generatedAt ? (
          <AdminLoadError message={adminData.error} onRetry={adminData.refresh} onLogout={logout} />
        ) : (
          <AdminPanel
            data={adminData.data}
            onMessage={setMessage}
            onLogout={logout}
            online={online}
            adminSession={session.cloudSession}
            onRefresh={adminData.refresh}
            onChangePin={handleChangePin}
          />
        )
      ) : null}
    </main>
  );
}

function AdminConnectionGate({ onLogout }: { onLogout: () => void }) {
  return (
    <section className="loading-screen admin-connection-gate">
      <BrandLogo alt="Tienda Castalia" className="loading-logo" />
      <h1>Administracion sin conexion</h1>
      <p className="muted">Por seguridad, los datos administrativos solo se consultan y modifican con internet.</p>
      <button type="button" onClick={onLogout}>Salir</button>
    </section>
  );
}

function AdminLoadError({
  message,
  onRetry,
  onLogout
}: {
  message: string;
  onRetry: () => Promise<void>;
  onLogout: () => void;
}) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section className="loading-screen admin-connection-gate">
      <BrandLogo alt="Tienda Castalia" className="loading-logo" />
      <h1>No se pudo cargar la administracion</h1>
      <p className="login-error-message">{message}</p>
      <div className="inline-actions">
        <button type="button" onClick={() => void retry()} disabled={retrying}>
          {retrying ? 'Reintentando...' : 'Reintentar'}
        </button>
        <button type="button" className="ghost" onClick={onLogout}>Salir</button>
      </div>
    </section>
  );
}

interface LoginScreenProps {
  onLogin: (session: AppSession) => Promise<void>;
  onMessage: (message: string) => void;
}

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}

function LoginScreen({ onLogin, onMessage }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [personalDevice, setPersonalDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpMessage, setHelpMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const appSession = await loginPin(normalizeLogin(username), password, {
        deviceMode: personalDevice ? 'personal' : 'shared'
      });
      await onLogin(appSession);
      setUsername('');
      setPassword('');
    } catch (error) {
      const loginError = error instanceof Error ? error.message : 'El usuario o el PIN no coinciden. Intentalo de nuevo.';
      setError(loginError);
      onMessage(loginError);
      if ('vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleUsernameChange(value: string) {
    setUsername(value);
    if (error) setError(null);
    if (helpMessage) setHelpMessage(null);
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    if (error) setError(null);
    if (helpMessage) setHelpMessage(null);
  }

  return (
    <section className="login-screen">
      <form className={`login-form-integrated ${error ? 'has-error' : ''}`} onSubmit={handleLogin}>
        <div className="login-brand">
          <div className="login-logo-clean">
            <BrandLogo alt="Tienda Castalia" className="login-logo-mark" />
          </div>
          <h1 className="login-title">Tienda Castalia</h1>
        </div>

        <div className="login-inputs-group">
          <label className="login-field">
            <span>Usuario</span>
            <input
              id="username"
              name="username"
              type="text"
              value={username}
              onChange={(event) => handleUsernameChange(event.target.value)}
              placeholder="Usuario"
              autoComplete="username"
              required
              className={error ? 'input-error' : ''}
            />
          </label>
          <label className="login-field">
            <span>PIN de acceso</span>
            <input
              id="password"
              name="password"
              value={password}
              onChange={(event) => handlePasswordChange(event.target.value)}
              placeholder="PIN de acceso"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              required
              className={error ? 'input-error' : ''}
            />
          </label>
        </div>

        <label className="login-device-option">
          <input
            type="checkbox"
            checked={personalDevice}
            onChange={(event) => setPersonalDevice(event.target.checked)}
          />
          <span>Este es mi dispositivo personal</span>
        </label>

        {error ? <div className="login-error-message" role="alert">{error}</div> : null}
        {helpMessage ? <div className="login-help-message">{helpMessage}</div> : null}

        <button
          type="submit"
          className="login-submit-btn"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? <span className="button-spinner" aria-hidden="true" /> : null}
          <span>{submitting ? 'Entrando...' : 'Entrar'}</span>
        </button>
        <button
          type="button"
          className="login-forgot-button"
          onClick={() => {
            const message =
              normalizeLogin(username) === 'admin'
                ? 'Recuperacion admin: usa el procedimiento manual definido por el administrador de la tienda.'
                : 'Pide al administrador que restablezca tu PIN desde el panel de usuarios.';
            setHelpMessage(message);
            onMessage(message);
          }}
        >
          Olvide mi PIN
        </button>
        {import.meta.env.DEV ? <p className="demo-help">Demo local: admin / 0000 · usuarios / 1234</p> : null}
      </form>
    </section>
  );
}
