import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { AdminPanel } from './components/AdminPanel';
import { BrandLogo } from './components/BrandLogo';
import { Kiosk } from './components/Kiosk';
import { ensureSeedData } from './data/seed';
import type { AppSession } from './domain/types';
import { useCloudUserData } from './hooks/useCloudUserData';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useTiendaData } from './hooks/useTiendaData';
import { changeCurrentPin, clearStoredSession, getStoredSession, loginPin } from './services/auth';
import { loadAdminSnapshot } from './services/adminApi';
import { refreshCatalog } from './services/catalog';
import { queueOrSubmitConsumption, syncPendingConsumptions } from './services/consumptions';
import { isSyncConfigured, syncNow } from './services/sync';

type AuthSession =
  | { role: 'admin'; cloudSession?: AppSession }
  | { role: 'user'; userId: string; cloudSession?: AppSession };

function authSessionFromAppSession(session: AppSession): AuthSession {
  return session.role === 'admin'
    ? { role: 'admin', cloudSession: session }
    : { role: 'user', userId: session.userId, cloudSession: session };
}

export function App() {
  const cloudMode = isSyncConfigured();
  const data = useTiendaData();
  const online = useOnlineStatus();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [message, setMessage] = useState('Listo para trabajar offline.');
  const cloudUserData = useCloudUserData(session?.role === 'user' ? session.cloudSession : null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        if (!cloudMode) {
          await ensureSeedData();
          return;
        }

        const stored = await getStoredSession();
        if (!stored) return;
        let current = stored;

        if (online) {
          if (stored.role === 'user') current = await refreshCatalog(stored);
          if (stored.role === 'admin') await loadAdminSnapshot(stored);
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
  }, [cloudMode, online]);

  useEffect(() => {
    if (!online || !isSyncConfigured()) return;

    const run = async () => {
      try {
        if (!cloudMode) {
          await syncNow();
          return;
        }

        const stored = await getStoredSession();
        if (!stored) return;

        if (stored.role === 'user') {
          const result = await syncPendingConsumptions(stored);
          await refreshCatalog(stored);
          if (result.submitted > 0) {
            setMessage(
              `${result.submitted} compra${result.submitted === 1 ? '' : 's'} pendiente${
                result.submitted === 1 ? '' : 's'
              } sincronizada${result.submitted === 1 ? '' : 's'}.`
            );
          }
        } else {
          await loadAdminSnapshot(stored);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Sincronizacion fallida.');
      }
    };

    run();
    const interval = window.setInterval(run, 30_000);
    return () => window.clearInterval(interval);
  }, [cloudMode, online]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const activeData = session?.role === 'user' && cloudMode ? cloudUserData : data;
  const loggedUser = session?.role === 'user' ? activeData.users.find((user) => user.id === session.userId) : undefined;

  function logout() {
    clearStoredSession().catch(() => undefined);
    setSession(null);
  }

  async function handleAuthenticatedSession(nextSession: AppSession) {
    let current = nextSession;
    if (cloudMode && online) {
      if (nextSession.role === 'user') current = await refreshCatalog(nextSession);
      if (nextSession.role === 'admin') await loadAdminSnapshot(nextSession);
    }
    setSession(authSessionFromAppSession(current));
  }

  async function handleChangePin(currentPin: string, newPin: string) {
    if (session?.role !== 'user' || !session.cloudSession) {
      throw new Error('No hay una sesion de usuario activa.');
    }
    await changeCurrentPin(session.cloudSession, currentPin, newPin);
  }

  if (!ready) {
    return (
      <main className="loading-screen">
        <BrandLogo alt="Tienda Castalia" className="loading-logo" />
        <p className="muted">Preparando...</p>
      </main>
    );
  }

  return (
    <main
      className={
        session?.role === 'user' ? 'app-shell user-shell' : session?.role === 'admin' ? 'app-shell admin-shell' : 'app-shell'
      }
    >
      {message ? <div className="toast">{message}</div> : null}

      {!session ? <LoginScreen onLogin={handleAuthenticatedSession} onMessage={setMessage} /> : null}

      {session?.role === 'user' && loggedUser ? (
        <Kiosk
          data={activeData}
          onMessage={setMessage}
          sessionUser={loggedUser}
          onLogout={logout}
          isSharedDevice={session.cloudSession?.deviceMode !== 'personal'}
          onChangePin={handleChangePin}
          onConfirmConsumption={(userId, cart) => queueOrSubmitConsumption(session.cloudSession, userId, cart)}
        />
      ) : null}

      {session?.role === 'admin' ? (
        <AdminPanel
          data={data}
          onMessage={setMessage}
          onLogout={logout}
          online={online}
          adminSession={session.cloudSession}
        />
      ) : null}
    </main>
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
            <BrandLogo alt="Tienda Castalia" variant="login" className="login-logo-mark" />
          </div>
          <h1 className="login-title">Tienda Castalia</h1>
        </div>

        <div className="login-inputs-group">
          <input
            value={username}
            onChange={(event) => handleUsernameChange(event.target.value)}
            placeholder="Usuario"
            autoComplete="username"
            autoFocus
            required
            className={error ? 'input-error' : ''}
          />
          <input
            value={password}
            onChange={(event) => handlePasswordChange(event.target.value)}
            placeholder="PIN de acceso"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            required
            className={error ? 'input-error' : ''}
          />
        </div>

        <label className="login-device-option">
          <input
            type="checkbox"
            checked={personalDevice}
            onChange={(event) => setPersonalDevice(event.target.checked)}
          />
          <span>Este es mi dispositivo personal</span>
        </label>

        {error ? <div className="login-error-message">{error}</div> : null}
        {helpMessage ? <div className="login-help-message">{helpMessage}</div> : null}

        <button type="submit" className="login-submit-btn" disabled={submitting}>
          {submitting ? 'Entrando...' : 'Entrar'}
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
        <p className="demo-help">Demo: admin / 0000 - Papa, Mama, Hijo / 1234</p>
      </form>
    </section>
  );
}
