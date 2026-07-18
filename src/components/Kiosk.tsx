import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  CheckCircle2,
  CircleX,
  CloudUpload,
  CreditCard,
  KeyRound,
  Loader2,
  LogOut,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
  X
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { SearchFilterIsland } from './SearchFilterIsland';
import type { CartItem, PersonUser, TiendaViewData } from '../domain/types';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useCollapsibleChrome } from '../hooks/useCollapsibleChrome';
import { formatMoney } from '../utils/money';

type TiendaData = TiendaViewData;
type AccountDetailTab = 'history' | 'payments';
type AccountFilter = 'all' | string;
type CheckoutState = 'idle' | 'submitting' | 'confirmed' | 'queued' | 'needs_review' | 'failed';
type PendingAction = { id: string; kind: 'retry' | 'discard' };
type ConfirmConsumptionResult = {
  status: 'confirmed' | 'pending' | 'needs_review';
  message?: string;
  officialTotal?: number;
  requiresLogin?: boolean;
};

interface DatedEntry {
  createdAt: string;
}

function dateKey(value: string) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function formatDayLabel(value: string) {
  const date = new Date(value);
  const entryKey = dateKey(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (entryKey === dateKey(today.toISOString())) return 'Hoy';
  if (entryKey === dateKey(yesterday.toISOString())) return 'Ayer';

  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(date);
}

function formatMovementTime(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function groupByDay<T extends DatedEntry>(entries: T[]) {
  const groups: Array<{ key: string; label: string; entries: T[] }> = [];

  entries.forEach((entry) => {
    const key = dateKey(entry.createdAt);
    const found = groups.find((group) => group.key === key);

    if (found) {
      found.entries.push(entry);
      return;
    }

    groups.push({
      key,
      label: formatDayLabel(entry.createdAt),
      entries: [entry]
    });
  });

  return groups;
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function trapFocusWithin(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
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

interface KioskProps {
  data: TiendaData;
  onMessage: (message: string) => void;
  sessionUser: PersonUser;
  onLogout: () => void;
  isSharedDevice: boolean;
  onChangePin?: (currentPin: string, newPin: string) => Promise<void>;
  onConfirmConsumption: (userId: string, cart: CartItem[]) => Promise<ConfirmConsumptionResult>;
  onRetryPendingConsumption?: (pendingId: string) => Promise<ConfirmConsumptionResult>;
  onDiscardPendingConsumption?: (pendingId: string) => Promise<void>;
}

export function Kiosk({
  data,
  onMessage,
  sessionUser,
  onLogout,
  isSharedDevice,
  onChangePin,
  onConfirmConsumption,
  onRetryPendingConsumption,
  onDiscardPendingConsumption
}: KioskProps) {
  return (
    <UserSession
      user={sessionUser}
      data={data}
      onMessage={onMessage}
      onLogout={onLogout}
      isSharedDevice={isSharedDevice}
      onChangePin={onChangePin}
      onConfirmConsumption={onConfirmConsumption}
      onRetryPendingConsumption={onRetryPendingConsumption}
      onDiscardPendingConsumption={onDiscardPendingConsumption}
    />
  );
}

interface UserSessionProps {
  user: PersonUser;
  data: TiendaData;
  onMessage: (message: string) => void;
  onLogout: () => void;
  isSharedDevice: boolean;
  onChangePin?: (currentPin: string, newPin: string) => Promise<void>;
  onConfirmConsumption: (userId: string, cart: CartItem[]) => Promise<ConfirmConsumptionResult>;
  onRetryPendingConsumption?: (pendingId: string) => Promise<ConfirmConsumptionResult>;
  onDiscardPendingConsumption?: (pendingId: string) => Promise<void>;
}

function UserSession({
  user,
  data,
  onMessage,
  onLogout,
  isSharedDevice,
  onChangePin,
  onConfirmConsumption,
  onRetryPendingConsumption,
  onDiscardPendingConsumption
}: UserSessionProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [category, setCategory] = useState('Todas');
  const [checkout, setCheckout] = useState(false);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>('idle');
  const [checkoutFeedback, setCheckoutFeedback] = useState('');
  const [confirmedCheckoutTotal, setConfirmedCheckoutTotal] = useState(0);
  const [accountDetailOpen, setAccountDetailOpen] = useState(false);
  const [accountDetailTab, setAccountDetailTab] = useState<AccountDetailTab>('history');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [headerFocused, setHeaderFocused] = useState(false);
  const [mobileChromeEnabled, setMobileChromeEnabled] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 860px)').matches
  );
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [discardConfirmId, setDiscardConfirmId] = useState<string | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const discardTriggerRef = useRef<HTMLButtonElement | null>(null);
  const discardCancelRef = useRef<HTMLButtonElement | null>(null);
  const checkoutLogoutTimerRef = useRef<number | null>(null);
  const profileHeadingId = useId();
  const checkoutHeadingId = useId();
  const discardHeadingId = useId();
  const discardDescriptionId = useId();
  const overlaysOpen = checkout || accountDetailOpen || pinModalOpen || profileMenuOpen || Boolean(discardConfirmId);
  const { collapsed, offset: chromeOffset, settling: chromeSettling, rebaseline } = useCollapsibleChrome({
    scroller: 'window',
    enabled: mobileChromeEnabled,
    pinned: overlaysOpen || headerFocused || searchFocused,
    resetKey: user.id,
    progressive: true,
    travel: 160
  });

  useEffect(() => {
    if (!isSharedDevice || data.pendingSync > 0) return;
    const events = ['click', 'keydown', 'touchstart'];
    let timeout = window.setTimeout(onLogout, 90_000);
    const reset = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(onLogout, 90_000);
    };
    events.forEach((event) => window.addEventListener(event, reset));
    return () => {
      window.clearTimeout(timeout);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [data.pendingSync, isSharedDevice, onLogout]);

  useEffect(() => {
    return () => {
      if (checkoutLogoutTimerRef.current) window.clearTimeout(checkoutLogoutTimerRef.current);
    };
  }, []);

  useBodyScrollLock(overlaysOpen);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(max-width: 860px)');
    const handleChange = (event: MediaQueryListEvent) => setMobileChromeEnabled(event.matches);
    setMobileChromeEnabled(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const focusFrame = window.requestAnimationFrame(() => profileCloseButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setProfileMenuOpen(false);
      window.requestAnimationFrame(() => profileButtonRef.current?.focus());
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!discardConfirmId) return;

    const focusFrame = window.requestAnimationFrame(() => discardCancelRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDiscardConfirmId(null);
      window.requestAnimationFrame(() => discardTriggerRef.current?.focus());
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [discardConfirmId]);

  useEffect(() => {
    setProductQuery('');
    setCategory('Todas');
    setAccountFilter('all');
    window.requestAnimationFrame(() => {
      const supportsWindowScrollTo =
        typeof window.scrollTo === 'function' && !window.navigator.userAgent.toLowerCase().includes('jsdom');
      try {
        if (supportsWindowScrollTo) {
          window.scrollTo({ top: 0 });
        } else {
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
        }
      } catch {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    });
  }, [user.id]);

  const account = user.accountId ? data.accounts.find((entry) => entry.id === user.accountId) : undefined;
  const pendingReviews = data.pendingConsumptions.filter(
    (entry) => entry.sessionUserId === user.id && entry.status === 'needs_review'
  );
  const accountBalance = user.accountId ? data.accountBalances.find((entry) => entry.accountId === user.accountId) : undefined;
  const accountUsers = user.accountId
    ? data.users.filter((entry) => entry.accountId === user.accountId && entry.status === 'active')
    : [user];
  const accountUserIds = new Set(accountUsers.map((entry) => entry.id));
  const categories = ['Todas', ...Array.from(new Set(data.products.map((product) => product.category))).sort()];
  const products = data.products
    .filter((product) => product.status === 'active')
    .filter((product) => category === 'Todas' || product.category === category)
    .filter((product) => product.name.toLowerCase().includes(productQuery.toLowerCase()));
  const cartDetails = cart
    .map((item) => {
      const product = data.products.find((entry) => entry.id === item.productId);
      return product ? { ...item, product, total: item.quantity * product.price } : null;
    })
    .filter(Boolean) as Array<CartItem & { product: (typeof data.products)[number]; total: number }>;
  const cartTotal = cartDetails.reduce((sum, item) => sum + item.total, 0);
  const accountHistory = data.consumptions.filter((entry) => accountUserIds.has(entry.userId));
  const accountPayments = data.payments.filter(
    (payment) =>
      (user.accountId ? payment.accountId === user.accountId : false) ||
      accountUserIds.has(payment.userId ?? '') ||
      accountUserIds.has(payment.paidByUserId ?? '')
  );
  const filteredHistory = accountHistory
    .filter((entry) => accountFilter === 'all' || entry.userId === accountFilter)
    .slice(0, 18);
  const filteredPayments = accountPayments
    .filter((payment) => accountFilter === 'all' || payment.userId === accountFilter || payment.paidByUserId === accountFilter)
    .slice(0, 18);
  const groupedHistory = groupByDay(filteredHistory);
  const groupedPayments = groupByDay(filteredPayments);
  const accountActivityAvailable = accountHistory.length > 0 || accountPayments.length > 0;

  const selfBalance = data.userBalances.find((entry) => entry.userId === user.id)?.balance ?? 0;
  const currentBalance = accountBalance?.balance ?? selfBalance;
  const projectedBalance = currentBalance + cartTotal;

  function addProduct(productId: string) {
    setCart((current) => {
      const found = current.find((item) => item.productId === productId);
      if (found) {
        return current.map((item) => (item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...current, { productId, quantity: 1 }];
    });
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((current) =>
      current
        .map((item) => (item.productId === productId ? { ...item, quantity: Math.max(0, quantity) } : item))
        .filter((item) => item.quantity > 0)
    );
  }

  function openCheckout() {
    if (cart.length === 0) return;
    setCheckoutFeedback('');
    setCheckoutState('idle');
    setCheckout(true);
  }

  function closeCheckout() {
    if (checkoutState === 'submitting') return;
    setCheckout(false);
    setCheckoutFeedback('');
    setCheckoutState('idle');
  }

  async function confirmConsumption() {
    if (cart.length === 0 || checkoutState === 'submitting') return;
    const confirmedTotal = cartTotal;

    try {
      setCheckout(true);
      setCheckoutState('submitting');
      setCheckoutFeedback('Registrando tu compra...');
      setConfirmedCheckoutTotal(confirmedTotal);

      const result = await onConfirmConsumption(user.id, cart);
      if (result.status === 'confirmed' && Number.isFinite(result.officialTotal)) {
        setConfirmedCheckoutTotal(result.officialTotal as number);
      }
      const shouldLogout = isSharedDevice && result.status === 'confirmed';
      const message = result.message ?? `Consumo confirmado por ${formatMoney(confirmedTotal)}.`;
      const nextFeedback = shouldLogout ? `${message} Cerrando sesion...` : message;
      setCheckoutFeedback(nextFeedback);
      setCheckoutState(
        result.status === 'confirmed' ? 'confirmed' : result.status === 'needs_review' ? 'needs_review' : 'queued'
      );
      onMessage(shouldLogout ? `${message} Sesion cerrada.` : message);
      setCart([]);

      if (shouldLogout) {
        checkoutLogoutTimerRef.current = window.setTimeout(() => {
          onLogout();
        }, 1200);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo confirmar.';
      setCheckoutFeedback(message);
      setCheckoutState('failed');
      onMessage(message);
    }
  }

  async function retryPendingConsumption(pendingId: string) {
    if (!onRetryPendingConsumption || pendingAction) return;
    setPendingAction({ id: pendingId, kind: 'retry' });
    try {
      const result = await onRetryPendingConsumption(pendingId);
      onMessage(result.message ?? 'Compra pendiente procesada.');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'No se pudo reintentar la compra pendiente.');
    } finally {
      setPendingAction(null);
    }
  }

  async function discardPendingConsumption(pendingId: string) {
    if (!onDiscardPendingConsumption || pendingAction) return;
    setDiscardConfirmId(null);
    setPendingAction({ id: pendingId, kind: 'discard' });
    try {
      await onDiscardPendingConsumption(pendingId);
      onMessage('Intento local descartado.');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'No se pudo descartar el intento local.');
    } finally {
      setPendingAction(null);
    }
  }

  function openDiscardConfirmation(pendingId: string, trigger: HTMLButtonElement) {
    if (!onDiscardPendingConsumption || pendingAction) return;
    discardTriggerRef.current = trigger;
    setDiscardConfirmId(pendingId);
  }

  function closeDiscardConfirmation(restoreFocus = true) {
    setDiscardConfirmId(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => discardTriggerRef.current?.focus());
    }
  }

  async function handleChangePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onChangePin) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPin = String(form.get('currentPin') ?? '');
    const newPin = String(form.get('newPin') ?? '');
    const confirmPin = String(form.get('confirmPin') ?? '');

    setPinError(null);
    if (newPin !== confirmPin) {
      setPinError('La confirmacion no coincide.');
      return;
    }
    if (!/^\d{4,8}$/.test(newPin)) {
      setPinError('El nuevo PIN debe tener entre 4 y 8 digitos.');
      return;
    }

    setPinSubmitting(true);
    try {
      await onChangePin(currentPin, newPin);
      setPinModalOpen(false);
      formElement.reset();
      onMessage('PIN actualizado.');
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'No se pudo cambiar el PIN.');
    } finally {
      setPinSubmitting(false);
    }
  }

  function openAccountDetail() {
    setAccountFilter('all');
    setProfileMenuOpen(false);
    setAccountDetailOpen(true);
  }

  function closeProfileMenu(restoreFocus = true) {
    setProfileMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => profileButtonRef.current?.focus());
    }
  }

  return (
    <section
      className={`kiosk-session ${collapsed ? 'chrome-is-collapsed' : 'chrome-is-expanded'} ${chromeSettling ? 'chrome-is-settling' : ''}`}
      style={mobileChromeEnabled ? { '--catalog-header-reveal': `${Math.max(0, 72 - chromeOffset)}px` } as CSSProperties : undefined}
    >
      <div
        className={`kiosk-header-slot ${collapsed ? 'chrome-collapsed' : 'chrome-expanded'}`}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === 'height') rebaseline();
        }}
      >
        <header
          className={`kiosk-header kiosk-header-island progressive-mobile-chrome ${chromeSettling ? 'is-settling' : ''}`}
          style={mobileChromeEnabled ? { transform: `translate3d(0, -${chromeOffset}px, 0)` } : undefined}
          aria-hidden={collapsed}
          inert={collapsed ? true : undefined}
          onFocusCapture={() => setHeaderFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setHeaderFocused(false);
            }
          }}
        >
          <div className="kiosk-brand-block">
            <div className="kiosk-logo" aria-hidden="true">
              <BrandLogo />
            </div>
            <div className="kiosk-brand-copy">
              <strong title={user.name}>{user.name}</strong>
              <span>Tienda</span>
            </div>
          </div>

          <div className="kiosk-account-actions">
            <div className="kiosk-user-card">
              <button
                type="button"
                className="account-link-button account-summary-button"
                onClick={openAccountDetail}
                aria-label={`Abrir mi cuenta. Saldo ${formatMoney(currentBalance)}`}
              >
                <span className="profile-summary-copy">
                  <span>Mi saldo</span>
                  <strong>{formatMoney(currentBalance)}</strong>
                </span>
              </button>
            </div>

            <button
              ref={profileButtonRef}
              type="button"
              className="ghost icon profile-menu-button"
              onClick={() => setProfileMenuOpen(true)}
              aria-label="Abrir perfil"
              aria-haspopup="dialog"
              aria-expanded={profileMenuOpen}
            >
              <UserRound size={20} />
            </button>
          </div>
        </header>
      </div>

      {data.pendingSync > 0 ? (
        <section className="pending-sync-banner" role="status" aria-live="polite">
          <strong>{data.pendingSync} compra{data.pendingSync === 1 ? '' : 's'} guardada{data.pendingSync === 1 ? '' : 's'} localmente</strong>
          <span>Se enviará al recuperar la conexión. En un dispositivo compartido la sesión permanecerá abierta hasta terminar.</span>
        </section>
      ) : null}

      {pendingReviews.length > 0 ? (
        <section className="pending-review-banner" role="alert" aria-label="Compras pendientes de revisión">
          <div>
            <strong>
              {pendingReviews.length} compra{pendingReviews.length === 1 ? '' : 's'} requiere{pendingReviews.length === 1 ? '' : 'n'} revisión
            </strong>
            <span>No se confirmó en Supabase. Reintenta después de corregir la causa o descarta solo el intento local.</span>
          </div>
          <div className="pending-review-list">
            {pendingReviews.map((entry) => {
              const retrying = pendingAction?.id === entry.id && pendingAction.kind === 'retry';
              const discarding = pendingAction?.id === entry.id && pendingAction.kind === 'discard';
              return (
                <article key={entry.id} aria-busy={retrying || discarding}>
                  <span>{entry.error ?? 'El servidor solicitó revisión manual.'}</span>
                  <small>{new Date(entry.createdAt).toLocaleString('es-CO')}</small>
                  <div className="inline-actions" aria-live="polite">
                    <button
                      type="button"
                      className={`ghost small ${retrying ? 'is-pending' : ''}`}
                      disabled={Boolean(pendingAction)}
                      onClick={() => void retryPendingConsumption(entry.id)}
                    >
                      {retrying ? (
                        <>
                          <Loader2
                            size={15}
                            className="pending-action-spinner"
                          />
                          Reintentando...
                        </>
                      ) : 'Reintentar'}
                    </button>
                    <button
                      type="button"
                      className={`ghost small danger ${discarding ? 'is-pending' : ''}`}
                      disabled={Boolean(pendingAction)}
                      onClick={(event) => openDiscardConfirmation(entry.id, event.currentTarget)}
                    >
                      {discarding ? (
                        <>
                          <Loader2
                            size={15}
                            className="pending-action-spinner"
                          />
                          Descartando...
                        </>
                      ) : 'Descartar intento'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="kiosk-workspace">
        <main className="catalog-area">
          <SearchFilterIsland
            className="catalog-search-filters user-catalog-search-filters"
            query={productQuery}
            onQueryChange={setProductQuery}
            options={categories.map((entry) => ({ value: entry, label: entry }))}
            activeValue={category}
            onActiveValueChange={setCategory}
            placeholder="Buscar producto..."
            searchLabel="Buscar producto"
            filtersLabel="Categorías"
            compact={collapsed && !productQuery.trim() && !searchFocused}
            onFocusChange={setSearchFocused}
          />
          <div className="product-grid catalog-grid">
            {products.length === 0 ? (
              <div className="admin-empty-state admin-catalog-empty catalog-empty-state" role="status">
                <Package size={36} aria-hidden="true" />
                <strong>No encontramos productos</strong>
                <span>Prueba con otra búsqueda o vuelve a ver todas las categorías.</span>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => {
                    setProductQuery('');
                    setCategory('Todas');
                  }}
                >
                  Limpiar filtros
                </button>
              </div>
            ) : products.map((product) => {
              const quantityInCart = cart.find((item) => item.productId === product.id)?.quantity ?? 0;
              const hasImage = product.imageUrl && !failedImages[product.id];
              return (
                <div
                  key={product.id}
                  className={quantityInCart > 0 ? 'product-tile in-cart' : 'product-tile'}
                  tabIndex={0}
                  onClick={() => addProduct(product.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      addProduct(product.id);
                    }
                  }}
                  aria-label={`Agregar ${product.name}`}
                >
                  <div className="product-media">
                    <span className="product-image-slot" aria-hidden="true">
                      {hasImage ? (
                        <img
                          src={product.imageUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={() => {
                            setFailedImages((prev) => ({ ...prev, [product.id]: true }));
                          }}
                        />
                      ) : (
                        <div className="product-placeholder-gradient">
                          <Package size={32} />
                          <span>{product.category}</span>
                        </div>
                      )}
                    </span>
                    <div className={quantityInCart > 0 ? 'product-details selected' : 'product-details'}>
                      {quantityInCart === 0 ? (
                        <>
                          <strong className="product-name" title={product.name}>
                            {product.name}
                          </strong>
                          <span className="product-price">{formatMoney(product.price)}</span>
                        </>
                      ) : (
                        <>
                          <span className="product-price">{formatMoney(product.price)}</span>
                          <div className="product-inline-stepper" role="group" aria-label={`Cantidad de ${product.name}`}>
                            <button
                              type="button"
                              className="product-inline-action dec"
                              onClick={(event) => {
                                event.stopPropagation();
                                updateQuantity(product.id, quantityInCart - 1);
                              }}
                              aria-label={`Restar una unidad de ${product.name}`}
                              title="Restar uno"
                            >
                              <Minus size={18} />
                            </button>
                            <span
                              key={`product-quantity-${product.id}-${quantityInCart}`}
                              className="product-inline-quantity quantity-pop"
                              aria-live="polite"
                            >
                              {quantityInCart}
                            </span>
                            <button
                              type="button"
                              className="product-inline-action inc"
                              onClick={(event) => {
                                event.stopPropagation();
                                addProduct(product.id);
                              }}
                              aria-label={`Sumar una unidad de ${product.name}`}
                              title="Sumar uno"
                            >
                              <Plus size={18} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {quantityInCart > 0 && (
                    <button
                      type="button"
                      className="tile-clear-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        updateQuantity(product.id, 0);
                      }}
                      aria-label={`Eliminar todas las unidades de ${product.name}`}
                      title="Eliminar del carrito"
                    >
                      <X size={16} />
                    </button>
                  )}

                </div>
              );
            })}
          </div>
        </main>

        <aside className="cart-sidebar">
          <div className="cart-sidebar-header">
            <h2>
              <ShoppingCart size={18} />
              Tu Compra
            </h2>
            {cart.length > 0 && (
              <span className="cart-count">
                {cart.reduce((sum, item) => sum + item.quantity, 0)} ítems
              </span>
            )}
          </div>

          <div className="cart-sidebar-list">
            {cartDetails.length === 0 ? (
              <div className="cart-sidebar-empty">
                <ShoppingCart size={32} />
                <p>Tu carrito está vacío</p>
                <small className="muted">Selecciona productos a la izquierda para agregarlos.</small>
              </div>
            ) : (
              cartDetails.map((item) => {
                const hasImage = item.product.imageUrl && !failedImages[item.productId];
                return (
                  <div className="cart-sidebar-item" key={item.productId}>
                    <div className="cart-sidebar-thumbnail">
                      {hasImage ? (
                        <img
                          src={item.product.imageUrl}
                          alt=""
                          onError={() => {
                            setFailedImages((prev) => ({ ...prev, [item.productId]: true }));
                          }}
                        />
                      ) : (
                        <div className="cart-sidebar-placeholder">
                          <Package size={14} />
                        </div>
                      )}
                    </div>
                    <div className="cart-item-info">
                      <span className="cart-item-name" title={item.product.name}>
                        {item.product.name}
                      </span>
                      <span className="cart-item-price">
                        {formatMoney(item.product.price)} c/u
                      </span>
                    </div>
                    <div className="cart-item-actions">
                      <button
                        type="button"
                        className="cart-action-subtract"
                        onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                        aria-label={`Restar ${item.product.name}`}
                      >
                        <Minus size={18} />
                      </button>
                      <span
                        key={`cart-quantity-${item.productId}-${item.quantity}`}
                        className="cart-item-quantity quantity-pop"
                      >
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        className="cart-action-add"
                        onClick={() => addProduct(item.productId)}
                        aria-label={`Sumar ${item.product.name}`}
                      >
                        <Plus size={18} />
                      </button>
                      <button
                        type="button"
                        className="cart-action-remove"
                        onClick={() => updateQuantity(item.productId, 0)}
                        title="Eliminar de carrito"
                        aria-label={`Eliminar ${item.product.name} del carrito`}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <span className="cart-item-total">
                      {formatMoney(item.total)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="cart-sidebar-summary">
            <div className="summary-row">
              <span>Saldo Actual:</span>
              <strong>{formatMoney(currentBalance)}</strong>
            </div>
            <div className="summary-row">
              <span>Total de Compra:</span>
              <strong>{formatMoney(cartTotal)}</strong>
            </div>
            <div className="summary-row balance-projection">
              <span>Saldo después de compra:</span>
              <strong className={projectedBalance <= 0 ? 'positive' : 'negative'}>
                {formatMoney(projectedBalance)}
              </strong>
            </div>

            <button
              className="cart-sidebar-btn"
              disabled={cart.length === 0}
              onClick={openCheckout}
            >
              Confirmar Compra
            </button>
          </div>
        </aside>
      </div>

      <footer className={`subtotal-bar${checkout && checkoutState === 'idle' ? ' checkout-mode' : ''}`}>
        <div>
          <span className="subtotal-label">Total</span>
          <strong>{formatMoney(cartTotal)}</strong>
        </div>
        <button
          disabled={cart.length === 0}
          onClick={checkout ? confirmConsumption : openCheckout}
          aria-label={checkout ? 'Confirmar compra' : 'Ver carrito'}
        >
          {checkout ? <CheckCircle2 size={18} /> : <ShoppingCart size={18} />}
          <span className="cart-button-label">{checkout ? 'Confirmar' : 'Ver carrito'}</span>
        </button>
      </footer>

      {profileMenuOpen ? (
        <div
          className="profile-sheet-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeProfileMenu();
          }}
        >
          <section
            className="profile-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={profileHeadingId}
            onKeyDown={trapFocusWithin}
          >
            <header className="profile-sheet-header">
              <div>
                <span>Perfil</span>
                <h2 id={profileHeadingId}>{user.name}</h2>
              </div>
              <button
                ref={profileCloseButtonRef}
                type="button"
                className="profile-sheet-close"
                onClick={() => closeProfileMenu()}
                aria-label="Cerrar perfil"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <button type="button" className="profile-sheet-summary" onClick={openAccountDetail}>
              <span className="profile-summary-icon" aria-hidden="true">
                <UserRound size={21} />
              </span>
              <span className="profile-summary-copy">
                <span>Mi saldo</span>
                <strong>{formatMoney(currentBalance)}</strong>
              </span>
            </button>

            <div className="profile-sheet-actions">
              <button type="button" onClick={openAccountDetail}>
                <Users size={20} aria-hidden="true" />
                Ver mi cuenta
              </button>
              {onChangePin ? (
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    setPinModalOpen(true);
                  }}
                >
                  <KeyRound size={20} aria-hidden="true" />
                  Cambiar PIN
                </button>
              ) : null}
              <button type="button" className="danger" onClick={onLogout}>
                <LogOut size={20} aria-hidden="true" />
                Salir
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {accountDetailOpen ? (
        <div className="modal-backdrop">
          <div className="modal account-modal" role="dialog" aria-modal="true" aria-label="Estado de cuenta">
            <div className="account-modal-hero">
              <div className="account-modal-title">
                <span>Saldo personal</span>
                <h2>{user.name}</h2>
                <p>
                  <Users size={15} />
                  {account?.name ? `Cuenta ${account.name}` : 'Usuario independiente'}
                </p>
              </div>

              <button className="account-close-button" onClick={() => setAccountDetailOpen(false)} aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>

            <section className="account-balance-stack" aria-label="Filtrar cuenta">
              <div className="account-balance-heading">
                <span>Mi saldo oficial</span>
                <small>Actualizado desde Supabase</small>
              </div>

              {accountUsers.map((entry) => {
                const balance = accountBalance?.users.find((item) => item.userId === entry.id)?.balance ?? 0;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={accountFilter === entry.id ? 'account-balance-row active' : 'account-balance-row'}
                    onClick={() => setAccountFilter(entry.id)}
                  >
                    <span className="account-avatar">{initials(entry.name)}</span>
                    <span className="account-balance-copy">
                      <strong>{entry.name}</strong>
                      {entry.id === user.id ? <small>Usuario actual</small> : <small>Usuario asociado</small>}
                    </span>
                    <strong className="account-balance-amount">{formatMoney(balance)}</strong>
                  </button>
                );
              })}

              <button
                type="button"
                className={accountFilter === 'all' ? 'account-balance-row total active' : 'account-balance-row total'}
                onClick={() => setAccountFilter('all')}
              >
                <span className="account-avatar">
                  <Users size={17} />
                </span>
                <span className="account-balance-copy">
                  <strong>Mi saldo</strong>
                  <small>{account?.name ?? 'Usuario independiente'}</small>
                </span>
                <strong className="account-balance-amount">{formatMoney(currentBalance)}</strong>
              </button>
            </section>

            {!accountActivityAvailable ? (
              <p className="account-empty-state">
                Este dispositivo conserva solo el catálogo y las compras pendientes. El historial oficial se consulta en administración.
              </p>
            ) : null}

            <div className="account-tabs" role="tablist" aria-label="Detalle de cuenta" hidden={!accountActivityAvailable}>
              <button
                className={accountDetailTab === 'history' ? 'active' : ''}
                onClick={() => setAccountDetailTab('history')}
              >
                Historial <span>{filteredHistory.length}</span>
              </button>
              <button
                className={accountDetailTab === 'payments' ? 'active' : ''}
                onClick={() => setAccountDetailTab('payments')}
              >
                Pagos <span>{filteredPayments.length}</span>
              </button>
            </div>

            {accountActivityAvailable && accountDetailTab === 'history' ? (
              <div className="account-timeline">
                {groupedHistory.map((group) => (
                  <section className="account-day-group" key={group.key}>
                    <div className="account-day-heading">
                      <span>{group.label}</span>
                      <small>{countLabel(group.entries.length, 'consumo', 'consumos')}</small>
                    </div>

                    <div className="account-day-list">
                      {group.entries.map((entry) => {
                        const entryUser = data.users.find((item) => item.id === entry.userId);
                        const entryItems = data.items.filter((item) => item.consumptionId === entry.id);
                        const entryUserName = entryUser?.name ?? 'Usuario';
                        return (
                          <article className={entry.status === 'voided' ? 'history-card voided' : 'history-card'} key={entry.id}>
                            <div className="history-card-header">
                              <div className="history-person">
                                <span className="account-avatar">{initials(entryUserName)}</span>
                                <div>
                                  <strong>{entryUserName}</strong>
                                  <span>{formatMovementTime(entry.createdAt)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="history-cart">
                              {entryItems.map((item) => {
                                const itemProduct = data.products.find((product) => product.id === item.productId);
                                const itemImageUrl = itemProduct?.imageUrl && !failedImages[item.productId]
                                  ? itemProduct.imageUrl
                                  : undefined;
                                return (
                                  <div className="history-cart-row" key={item.id}>
                                    <span className="history-item-thumbnail">
                                      {itemImageUrl ? (
                                        <img
                                          src={itemImageUrl}
                                          alt=""
                                          onError={() => {
                                            setFailedImages((prev) => ({ ...prev, [item.productId]: true }));
                                          }}
                                        />
                                      ) : (
                                        <span className="history-item-placeholder">
                                          <Package size={16} />
                                        </span>
                                      )}
                                    </span>

                                    <span className="history-item-info">
                                      <strong>{item.productName}</strong>
                                      <small>{formatMoney(item.unitPrice)} c/u</small>
                                    </span>

                                    <span className="history-item-qty">
                                      <small>Cant.</small>
                                      <strong>x{item.quantity}</strong>
                                    </span>
                                    <span className="history-item-subtotal">
                                      <small>Subtotal</small>
                                      <strong>{formatMoney(item.total)}</strong>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="history-card-footer">
                              <span>Total compra</span>
                              <strong>{formatMoney(entry.total)}</strong>
                            </div>

                            {entry.status === 'voided' ? <small className="danger-text">Anulado</small> : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {filteredHistory.length === 0 ? <p className="account-empty-state">Sin consumos para este filtro.</p> : null}
              </div>
            ) : null}

            {accountActivityAvailable && accountDetailTab === 'payments' ? (
              <div className="account-timeline">
                {groupedPayments.map((group) => (
                  <section className="account-day-group" key={group.key}>
                    <div className="account-day-heading">
                      <span>{group.label}</span>
                      <small>{countLabel(group.entries.length, 'pago', 'pagos')}</small>
                    </div>

                    <div className="account-day-list">
                      {group.entries.map((payment) => {
                        const paymentUser = payment.userId ? data.users.find((entry) => entry.id === payment.userId) : null;
                        return (
                          <article className="payment-card" key={payment.id}>
                            <span className="payment-icon">
                              <CreditCard size={18} />
                            </span>

                            <div className="payment-card-copy">
                              <strong>Pago recibido</strong>
                              <span>
                                {formatMovementTime(payment.createdAt)} ·{' '}
                                {payment.targetType === 'user' && paymentUser
                                  ? paymentUser.name
                                  : 'Cuenta completa'}
                              </span>
                              {payment.note ? <small>{payment.note}</small> : null}
                            </div>

                            <strong className="payment-amount">+ {formatMoney(payment.amount)}</strong>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {filteredPayments.length === 0 ? <p className="account-empty-state">No hay pagos para este filtro.</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {discardConfirmId ? (
        <div
          className="modal-backdrop confirm-action-sheet-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDiscardConfirmation();
          }}
        >
          <section
            className="modal pin-modal confirm-action-sheet pending-discard-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={discardHeadingId}
            aria-describedby={discardDescriptionId}
            onKeyDown={trapFocusWithin}
          >
            <div className="pin-modal-header">
              <h2 id={discardHeadingId}>¿Descartar este intento?</h2>
              <button
                type="button"
                className="account-close-button"
                onClick={() => closeDiscardConfirmation()}
                aria-label="Cerrar confirmación"
              >
                <X size={20} />
              </button>
            </div>
            <p id={discardDescriptionId} className="admin-confirm-copy">
              Se eliminará únicamente este intento guardado en el dispositivo. Ninguna compra confirmada en Supabase será eliminada.
            </p>
            <div className="modal-actions confirm-action-sheet-actions">
              <button
                ref={discardCancelRef}
                type="button"
                className="ghost"
                onClick={() => closeDiscardConfirmation()}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="ghost danger"
                onClick={() => void discardPendingConsumption(discardConfirmId)}
              >
                Descartar intento
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {checkout ? (
        <div className="modal-backdrop checkout-backdrop">
          <div
            className={
              checkoutState === 'idle'
                ? 'modal wide checkout-modal checkout-state-idle'
                : `modal checkout-feedback-modal checkout-state-${checkoutState}`
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby={checkoutHeadingId}
          >
            <div className="checkout-modal-header">
              <h2 id={checkoutHeadingId}>
                {checkoutState === 'confirmed'
                  ? 'Compra confirmada'
                  : checkoutState === 'queued'
                    ? 'Compra guardada'
                    : checkoutState === 'needs_review'
                      ? 'Revisión necesaria'
                      : checkoutState === 'failed'
                        ? 'No pudimos confirmar'
                        : checkoutState === 'submitting'
                          ? 'Confirmando compra'
                          : 'Confirmar consumo'}
              </h2>
              {checkoutState === 'idle' ? (
                <button
                  type="button"
                  className="checkout-close-button"
                  onClick={closeCheckout}
                  aria-label="Cerrar"
                >
                  <X size={20} />
                </button>
              ) : null}
            </div>
            {checkoutState === 'idle' ? (
              <>
                <div className="cart-list">
                  {cartDetails.map((item) => {
                    const hasImage = item.product.imageUrl && !failedImages[item.productId];
                    return (
                      <div
                        className="checkout-item-row"
                        key={item.productId}
                      >
                        <div className="checkout-item-thumbnail">
                          {hasImage ? (
                            <img
                              src={item.product.imageUrl}
                              alt=""
                              onError={() => {
                                setFailedImages((prev) => ({ ...prev, [item.productId]: true }));
                              }}
                            />
                          ) : (
                            <div className="checkout-item-placeholder">
                              <Package size={20} />
                            </div>
                          )}
                        </div>

                        <div className="checkout-item-info">
                          <span className="checkout-item-name" title={item.product.name}>
                            {item.product.name}
                          </span>
                          <span className="checkout-item-price-each">
                            {formatMoney(item.product.price)} c/u
                          </span>
                        </div>

                        <div className="checkout-item-controls">
                          <button
                            type="button"
                            className="checkout-qty-btn checkout-qty-btn-minus"
                            onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                            aria-label={`Restar ${item.product.name}`}
                          >
                            <Minus size={18} />
                          </button>
                          <span
                            key={`checkout-quantity-${item.productId}-${item.quantity}`}
                            className="checkout-qty-value quantity-pop"
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            className="checkout-qty-btn checkout-qty-btn-plus"
                            onClick={() => addProduct(item.productId)}
                            aria-label={`Sumar ${item.product.name}`}
                          >
                            <Plus size={18} />
                          </button>
                        </div>

                        <div className="checkout-item-subtotal">
                          <span className="checkout-subtotal-label">Subtotal</span>
                          <span className="checkout-subtotal-value">{formatMoney(item.total)}</span>
                        </div>

                        <button
                          type="button"
                          className="checkout-item-remove"
                          onClick={() => updateQuantity(item.productId, 0)}
                          title="Eliminar del carrito"
                          aria-label={`Eliminar ${item.product.name} del carrito`}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <footer className="checkout-footer">
                  <div className="checkout-total">
                    <span>Total</span>
                    <strong>{formatMoney(cartTotal)}</strong>
                  </div>
                  <div className="checkout-actions">
                    <button className="checkout-primary-action" onClick={confirmConsumption} disabled={cart.length === 0}>
                      {isSharedDevice ? 'Confirmar y salir' : 'Confirmar compra'}
                    </button>
                  </div>
                </footer>
              </>
            ) : (
              <div
                className={`checkout-feedback-panel checkout-feedback-${checkoutState}`}
                role={checkoutState === 'failed' ? 'alert' : 'status'}
                aria-live={checkoutState === 'failed' ? 'assertive' : 'polite'}
              >
                <span
                  className={`checkout-feedback-icon ${checkoutState === 'confirmed' ? 'success' : `is-${checkoutState}`}`}
                >
                  {checkoutState === 'confirmed' ? (
                    <CheckCircle2 size={34} />
                  ) : checkoutState === 'submitting' ? (
                    <Loader2 size={34} />
                  ) : checkoutState === 'queued' ? (
                    <CloudUpload size={34} />
                  ) : checkoutState === 'needs_review' ? (
                    <TriangleAlert size={34} />
                  ) : (
                    <CircleX size={34} />
                  )}
                </span>
                <strong>
                  {checkoutState === 'confirmed'
                    ? formatMoney(confirmedCheckoutTotal)
                    : checkoutState === 'queued'
                      ? 'Pendiente de envío'
                      : checkoutState === 'needs_review'
                        ? 'Sin confirmar'
                        : checkoutState === 'failed'
                          ? 'Intenta nuevamente'
                          : 'Un momento'}
                </strong>
                <p>{checkoutFeedback}</p>
                {checkoutState === 'failed' ? (
                  <div className="checkout-feedback-actions">
                    <button type="button" className="checkout-primary-action" onClick={() => void confirmConsumption()}>
                      Reintentar
                    </button>
                    <button type="button" className="ghost" onClick={closeCheckout}>
                      Revisar carrito
                    </button>
                  </div>
                ) : checkoutState !== 'submitting' && !(checkoutState === 'confirmed' && isSharedDevice) ? (
                  <button type="button" className="checkout-primary-action" onClick={closeCheckout}>
                    {checkoutState === 'confirmed' ? 'Seguir comprando' : 'Volver al catálogo'}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {pinModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal pin-modal" role="dialog" aria-modal="true" aria-label="Cambiar PIN">
            <div className="pin-modal-header">
              <h2>Cambiar PIN</h2>
              <button className="account-close-button" onClick={() => setPinModalOpen(false)} aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
            <form className="pin-change-form" onSubmit={handleChangePin}>
              <input name="currentPin" type="password" inputMode="numeric" placeholder="PIN actual" aria-label="PIN actual" required />
              <input name="newPin" type="password" inputMode="numeric" placeholder="Nuevo PIN" aria-label="Nuevo PIN" required />
              <input name="confirmPin" type="password" inputMode="numeric" placeholder="Confirmar nuevo PIN" aria-label="Confirmar nuevo PIN" required />
              {pinError ? <div className="login-error-message">{pinError}</div> : null}
              <div className="modal-actions">
                <button type="submit" className="primary" disabled={pinSubmitting}>
                  {pinSubmitting ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
