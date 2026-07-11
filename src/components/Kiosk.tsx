import type { FormEvent } from 'react';
import { CreditCard, KeyRound, LogOut, Minus, Package, Plus, Search, ShoppingCart, Store, Trash2, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CartItem, PersonUser } from '../domain/types';
import type { useTiendaData } from '../hooks/useTiendaData';
import { createConsumption } from '../services/operations';
import { formatMoney } from '../utils/money';

type TiendaData = ReturnType<typeof useTiendaData>;
type AccountDetailTab = 'history' | 'payments';
type AccountFilter = 'all' | string;
type ConfirmConsumptionResult = {
  status: 'confirmed' | 'pending' | 'needs_review';
  message?: string;
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

interface KioskProps {
  data: TiendaData;
  onMessage: (message: string) => void;
  sessionUser: PersonUser;
  onLogout: () => void;
  isSharedDevice: boolean;
  onChangePin?: (currentPin: string, newPin: string) => Promise<void>;
  onConfirmConsumption?: (userId: string, cart: CartItem[]) => Promise<ConfirmConsumptionResult>;
}

export function Kiosk({ data, onMessage, sessionUser, onLogout, isSharedDevice, onChangePin, onConfirmConsumption }: KioskProps) {
  return (
    <UserSession
      user={sessionUser}
      data={data}
      onMessage={onMessage}
      onLogout={onLogout}
      isSharedDevice={isSharedDevice}
      onChangePin={onChangePin}
      onConfirmConsumption={onConfirmConsumption}
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
  onConfirmConsumption?: (userId: string, cart: CartItem[]) => Promise<ConfirmConsumptionResult>;
}

function UserSession({ user, data, onMessage, onLogout, isSharedDevice, onChangePin, onConfirmConsumption }: UserSessionProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [category, setCategory] = useState('Todas');
  const [checkout, setCheckout] = useState(false);
  const [accountDetailOpen, setAccountDetailOpen] = useState(false);
  const [accountDetailTab, setAccountDetailTab] = useState<AccountDetailTab>('history');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [searchBarVisible, setSearchBarVisible] = useState(true);
  const [swipedCheckoutItemId, setSwipedCheckoutItemId] = useState<string | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const catalogAreaRef = useRef<HTMLElement | null>(null);
  const lastCatalogScrollTop = useRef(0);
  const searchBarVisibleRef = useRef(true);
  const checkoutTouchStartX = useRef(0);
  const checkoutTouchStartY = useRef(0);

  useEffect(() => {
    if (!isSharedDevice) return;
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
  }, [isSharedDevice, onLogout]);

  useEffect(() => {
    const modalOpen = checkout || accountDetailOpen || pinModalOpen;
    if (!modalOpen) return;

    const scrollY = window.scrollY;
    const { style } = document.body;
    const previous = {
      overflow: style.overflow,
      position: style.position,
      top: style.top,
      width: style.width,
    };

    style.overflow = 'hidden';
    style.position = 'fixed';
    style.top = `-${scrollY}px`;
    style.width = '100%';

    return () => {
      style.overflow = previous.overflow;
      style.position = previous.position;
      style.top = previous.top;
      style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, [checkout, accountDetailOpen, pinModalOpen]);

  useEffect(() => {
    setProductQuery('');
    setCategory('Todas');
    setAccountFilter('all');
    searchBarVisibleRef.current = true;
    setSearchBarVisible(true);
    window.requestAnimationFrame(() => {
      const catalogArea = catalogAreaRef.current;
      if (typeof catalogArea?.scrollTo === 'function') {
        catalogArea.scrollTo({ top: 0 });
      } else if (catalogArea) {
        catalogArea.scrollTop = 0;
      }
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
      lastCatalogScrollTop.current = 0;
    });
  }, [user.id]);

  useEffect(() => {
    const setVisible = (visible: boolean) => {
      if (searchBarVisibleRef.current === visible) return;
      searchBarVisibleRef.current = visible;
      setSearchBarVisible(visible);
    };

    const getScrollTop = () => {
      const catalogArea = catalogAreaRef.current;
      if (catalogArea && catalogArea.scrollHeight > catalogArea.clientHeight) {
        return catalogArea.scrollTop;
      }
      return window.scrollY;
    };

    const handleScroll = () => {
      const scrollTop = getScrollTop();
      const delta = scrollTop - lastCatalogScrollTop.current;

      if (scrollTop <= 24) {
        setVisible(true);
      } else if (delta > 10) {
        setVisible(false);
      } else if (delta < -6) {
        setVisible(true);
      }

      lastCatalogScrollTop.current = scrollTop;
    };

    const catalogArea = catalogAreaRef.current;
    lastCatalogScrollTop.current = getScrollTop();
    window.addEventListener('scroll', handleScroll, { passive: true });
    catalogArea?.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      catalogArea?.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const account = data.accounts.find((entry) => entry.id === user.accountId);
  const accountBalance = data.accountBalances.find((entry) => entry.accountId === user.accountId);
  const accountUsers = data.users.filter((entry) => entry.accountId === user.accountId && entry.status === 'active');
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
  const accountHistory = data.consumptions.filter((entry) => entry.accountId === user.accountId);
  const accountPayments = data.payments.filter((payment) => payment.accountId === user.accountId);
  const filteredHistory = accountHistory
    .filter((entry) => accountFilter === 'all' || entry.userId === accountFilter)
    .slice(0, 18);
  const filteredPayments = accountPayments
    .filter((payment) => accountFilter === 'all' || payment.userId === accountFilter)
    .slice(0, 18);
  const groupedHistory = groupByDay(filteredHistory);
  const groupedPayments = groupByDay(filteredPayments);

  const currentBalance = accountBalance?.balance ?? 0;
  const projectRemainingBalance = currentBalance - cartTotal;

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
    if (quantity <= 0) setSwipedCheckoutItemId(null);
  }

  function startCheckoutSwipe(x: number, y: number) {
    checkoutTouchStartX.current = x;
    checkoutTouchStartY.current = y;
  }

  function endCheckoutSwipe(productId: string, x: number, y: number) {
    const deltaX = x - checkoutTouchStartX.current;
    const deltaY = y - checkoutTouchStartY.current;
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;
    if (deltaX < -36) setSwipedCheckoutItemId(productId);
    if (deltaX > 28) setSwipedCheckoutItemId(null);
  }

  async function confirmConsumption() {
    try {
      const result = onConfirmConsumption
        ? await onConfirmConsumption(user.id, cart)
        : { status: 'confirmed' as const, message: undefined };
      if (!onConfirmConsumption) {
        await createConsumption(user.id, cart);
      }
      const message = result.message ?? `Consumo confirmado por ${formatMoney(cartTotal)}.`;
      onMessage(isSharedDevice ? `${message} Sesion cerrada.` : message);
      setCart([]);
      setCheckout(false);
      if (isSharedDevice) onLogout();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'No se pudo confirmar.');
    }
  }

  async function handleChangePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onChangePin) return;
    const form = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
      onMessage('PIN actualizado.');
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'No se pudo cambiar el PIN.');
    } finally {
      setPinSubmitting(false);
    }
  }

  return (
    <section className={searchBarVisible ? 'kiosk-session catalog-search-visible' : 'kiosk-session catalog-search-hidden'}>
      <header className="kiosk-header">
        <div className="kiosk-brand-block">
          <div className="kiosk-logo" aria-hidden="true">
            <Store size={24} />
          </div>
          <div className="kiosk-brand-copy">
            <strong>Tienda Castalia</strong>
            <span>Usuario: {user.name}</span>
          </div>
        </div>

        <div className="kiosk-user-card">
          <button
            className="account-link-button account-summary-button"
            onClick={() => {
              setAccountFilter('all');
              setAccountDetailOpen(true);
            }}
            aria-label={`Ver cuenta ${account?.name ?? ''}`}
          >
            <span>{account?.name ?? 'Cuenta'}</span>
            <strong>{formatMoney(currentBalance)}</strong>
          </button>
        </div>

        <button className="ghost icon logout-button" onClick={onLogout} aria-label="Salir">
          <LogOut size={20} />
        </button>
        {onChangePin ? (
          <button className="ghost icon logout-button" onClick={() => setPinModalOpen(true)} aria-label="Cambiar PIN">
            <KeyRound size={20} />
          </button>
        ) : null}
      </header>

      <div className="kiosk-workspace">
        <main className="catalog-area" ref={catalogAreaRef}>
          <div className="catalog-toolbar">
            <label className="search catalog-search">
              <Search size={18} />
              <input
                value={productQuery}
                onChange={(event) => setProductQuery(event.target.value)}
                onFocus={() => {
                  searchBarVisibleRef.current = true;
                  setSearchBarVisible(true);
                }}
                placeholder="Buscar producto..."
              />
            </label>
          </div>

          <div className="category-pills catalog-filter-bar">
            {categories.map((entry) => (
              <button
                key={entry}
                type="button"
                className={category === entry ? 'category-pill active' : 'category-pill'}
                onClick={() => setCategory(entry)}
              >
                {entry}
              </button>
            ))}
          </div>

          <div className="product-grid catalog-grid">
            {products.map((product) => {
              const quantityInCart = cart.find((item) => item.productId === product.id)?.quantity ?? 0;
              const hasImage = product.imageUrl && !failedImages[product.id];
              return (
                <div key={product.id} className={quantityInCart > 0 ? 'product-tile in-cart' : 'product-tile'}>
                  <div
                    className="product-media"
                    role="button"
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
                  </div>

                  {quantityInCart > 0 && (
                    <button
                      type="button"
                      className="tile-clear-btn"
                      onClick={() => updateQuantity(product.id, 0)}
                      aria-label={`Quitar ${product.name}`}
                      title="Quitar"
                    >
                      <X size={16} />
                    </button>
                  )}

                  <div className="product-details">
                    <strong className="product-name" title={product.name}>
                      {product.name}
                    </strong>
                    <span className="product-price">{formatMoney(product.price)}</span>
                  </div>

                  <div className={`product-tile-action-bar ${quantityInCart > 0 ? 'selected' : ''}`}>
                    {quantityInCart === 0 ? (
                      <button
                        type="button"
                        className="tile-add-btn"
                        onClick={() => addProduct(product.id)}
                      >
                        <Plus size={16} />
                        Agregar
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="tile-action-btn dec"
                          onClick={() => updateQuantity(product.id, quantityInCart - 1)}
                          aria-label="Restar uno"
                        >
                          <Minus size={18} />
                        </button>
                        <span className="tile-action-qty">{quantityInCart}</span>
                        <button
                          type="button"
                          className="tile-action-btn inc"
                          onClick={() => addProduct(product.id)}
                          aria-label="Sumar uno"
                        >
                          <Plus size={18} />
                        </button>
                      </>
                    )}
                  </div>
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
                      <span className="cart-item-quantity">{item.quantity}</span>
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
              <span>Saldo Restante:</span>
              <strong className={projectRemainingBalance >= 0 ? 'positive' : 'negative'}>
                {formatMoney(projectRemainingBalance)}
              </strong>
            </div>

            <button
              className="cart-sidebar-btn"
              disabled={cart.length === 0}
              onClick={confirmConsumption}
            >
              Confirmar Compra
            </button>
          </div>
        </aside>
      </div>

      <footer className="subtotal-bar">
        <div>
          <span>Subtotal</span>
          <strong>{formatMoney(cartTotal)}</strong>
        </div>
        <button disabled={cart.length === 0} onClick={() => setCheckout(true)}>
          <ShoppingCart size={18} />
          Ver carrito
        </button>
      </footer>

      {accountDetailOpen ? (
        <div className="modal-backdrop">
          <div className="modal account-modal">
            <div className="account-modal-hero">
              <div className="account-modal-title">
                <span>Estado de cuenta</span>
                <h2>{account?.name ?? 'Cuenta'}</h2>
                <p>
                  <Users size={15} />
                  {accountUsers.length} usuarios asociados
                </p>
              </div>

              <button className="account-close-button" onClick={() => setAccountDetailOpen(false)} aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>

            <section className="account-balance-stack" aria-label="Filtrar cuenta">
              <div className="account-balance-heading">
                <span>Subtotales por usuario</span>
                <small>Toca una fila para filtrar</small>
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
                  <strong>Total cuenta</strong>
                  <small>{account?.name ?? 'Cuenta completa'}</small>
                </span>
                <strong className="account-balance-amount">{formatMoney(currentBalance)}</strong>
              </button>
            </section>

            <div className="account-tabs" role="tablist" aria-label="Detalle de cuenta">
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

            {accountDetailTab === 'history' ? (
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

            {accountDetailTab === 'payments' ? (
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

      {checkout ? (
        <div className="modal-backdrop">
          <div className="modal wide checkout-modal">
            <h2>Confirmar consumo</h2>
            <div className="cart-list">
              {cartDetails.map((item) => {
                const hasImage = item.product.imageUrl && !failedImages[item.productId];
                return (
                  <div
                    className={`checkout-item-row ${swipedCheckoutItemId === item.productId ? 'is-swiped' : ''}`}
                    key={item.productId}
                    onTouchStart={(event) => {
                      const touch = event.touches[0];
                      if (touch) startCheckoutSwipe(touch.clientX, touch.clientY);
                    }}
                    onTouchEnd={(event) => {
                      const touch = event.changedTouches[0];
                      if (touch) endCheckoutSwipe(item.productId, touch.clientX, touch.clientY);
                    }}
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
                      <span className="checkout-qty-value">{item.quantity}</span>
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
                      onClick={() => {
                        updateQuantity(item.productId, 0);
                        setSwipedCheckoutItemId(null);
                      }}
                      title="Quitar"
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
                <button className="ghost checkout-secondary-action" onClick={() => setCheckout(false)}>
                  Seguir editando
                </button>
                <button className="checkout-primary-action" onClick={confirmConsumption}>
                  Confirmar y salir
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}

      {pinModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal pin-modal">
            <button className="account-close-button" onClick={() => setPinModalOpen(false)} aria-label="Cerrar">
              <X size={20} />
            </button>
            <h2>Cambiar PIN</h2>
            <form className="pin-change-form" onSubmit={handleChangePin}>
              <input name="currentPin" type="password" inputMode="numeric" placeholder="PIN actual" required />
              <input name="newPin" type="password" inputMode="numeric" placeholder="Nuevo PIN" required />
              <input name="confirmPin" type="password" inputMode="numeric" placeholder="Confirmar nuevo PIN" required />
              {pinError ? <div className="login-error-message">{pinError}</div> : null}
              <div className="modal-actions">
                <button type="button" className="ghost" onClick={() => setPinModalOpen(false)}>
                  Cancelar
                </button>
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
