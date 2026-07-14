import type { ChangeEvent, FormEvent } from 'react';
import { useMemo, useState } from 'react';
import {
  Boxes,
  BrushCleaning,
  CreditCard,
  DollarSign,
  Edit,
  Eye,
  CircleCheck,
  LogOut,
  PackagePlus,
  Plus,
  ReceiptText,
  Search,
  Split,
  Store,
  User,
  Users,
  Package,
  X,
  Cloud,
  CloudOff,
  RefreshCw,
  History,
  KeyRound,
  Undo2,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import type { Account, AppSession, Product, TiendaViewData } from '../domain/types';
import { BrandLogo } from './BrandLogo';
import { calculateOpenConsumptions, roundMoney } from '../domain/ledger';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import * as adminApi from '../services/adminApi';
import { formatMoney, toNumber } from '../utils/money';
import { isSyncConfigured } from '../services/sync';

type TiendaData = TiendaViewData;
type AdminSection = null | 'catalogo' | 'cuentas' | 'cobros' | 'productos';
type ProductFilter = 'active' | 'inactive' | 'low' | 'all';
type AccountFilter = 'debt' | 'clear' | 'inactive' | 'all';
type AccountPanelTab = 'accounts' | 'users';
type UserFilter = 'active' | 'debt' | 'inactive' | 'all';
type ChargePanelTab = 'receivables' | 'history';
type BulkProductAction = 'purchase' | 'inventory' | 'prices';
type AdminAccountDetailTab = 'history' | 'payments';
type ModalState = null | { type: string; target?: any };
const PRODUCT_CATEGORIES = ['Bebidas', 'Comida', 'Dulces', 'Otros'] as const;

interface DatedEntry {
  createdAt: string;
}

interface AdminPanelProps {
  data: TiendaData;
  onMessage: (message: string) => void;
  onLogout: () => void;
  online: boolean;
  adminSession?: AppSession;
  onRefresh?: () => Promise<void>;
  onChangePin?: (currentPin: string, newPin: string) => Promise<void>;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function productStock(data: TiendaData, productId: string): number {
  return data.productStocks.find((entry) => entry.productId === productId)?.stock ?? 0;
}

function productPriority(product: Product, stock: number): number {
  if (product.status === 'inactive') return 4;
  if (stock <= 0) return 0;
  if (stock <= product.stockMin) return 1;
  return 2;
}

function productTone(product: Product, stock: number): 'empty' | 'low' | 'ok' | 'inactive' {
  if (product.status === 'inactive') return 'inactive';
  if (stock <= 0) return 'empty';
  if (stock <= product.stockMin) return 'low';
  return 'ok';
}

function productStatusLabel(tone: ReturnType<typeof productTone>): string {
  if (tone === 'empty') return 'Agotado';
  if (tone === 'low') return 'Bajo';
  if (tone === 'inactive') return 'Inactivo';
  return 'OK';
}

function latestAccountActivity(data: TiendaData, accountId: string): string {
  const dates = [
    ...data.consumptions.filter((entry) => entry.accountId === accountId).map((entry) => entry.createdAt),
    ...data.payments.filter((entry) => entry.accountId === accountId).map((entry) => entry.createdAt),
    ...data.adjustments.filter((entry) => entry.accountId === accountId).map((entry) => entry.createdAt)
  ].filter(Boolean);

  if (dates.length === 0) return 'Sin movimientos';
  const latest = dates.sort((a, b) => b.localeCompare(a))[0];
  return new Date(latest).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function latestUserActivity(data: TiendaData, userId: string): string {
  const dates = [
    ...data.consumptions.filter((entry) => entry.userId === userId).map((entry) => entry.createdAt),
    ...data.payments.filter((entry) => entry.userId === userId).map((entry) => entry.createdAt),
    ...data.adjustments.filter((entry) => entry.userId === userId).map((entry) => entry.createdAt)
  ].filter(Boolean);

  if (dates.length === 0) return 'Sin movimientos';
  const latest = dates.sort((a, b) => b.localeCompare(a))[0];
  return new Date(latest).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
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

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
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

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function LegacyAdminPanel({ data, onMessage, onLogout, online, adminSession, onRefresh }: AdminPanelProps) {
  const [activeSection, setActiveSection] = useState<AdminSection>(null);
  const [activeModal, setActiveModal] = useState<ModalState>(null);

  function toggleSection(section: AdminSection) {
    setActiveSection((current) => (current === section ? null : section));
  }

  const activeAccountsCount = data.accounts.filter((a) => a.status === 'active').length;
  const activeProductsCount = data.products.filter((p) => p.status === 'active').length;

  return (
    <section className="admin-session">
      {/* ── Header branded ── */}
      <header className="kiosk-header">
        <div className="kiosk-brand-block">
          <div className="kiosk-logo" aria-hidden="true">
            <BrandLogo />
          </div>
          <div className="kiosk-brand-copy">
            <strong>Tienda</strong>
            <span>Administrador</span>
          </div>
        </div>

        {/* Componente compacto de Sync en el header */}
        <div className="admin-header-widgets">
          <HeaderSyncWidget
            online={online}
            pendingSync={data.pendingSync}
            onMessage={onMessage}
            onManualSync={
              onRefresh
                ? async () => {
                    await onRefresh();
                    return 'Datos de administrador actualizados.';
                  }
                : undefined
            }
          />
        </div>

        <button className="ghost icon logout-button" onClick={onLogout} aria-label="Salir">
          <LogOut size={20} />
        </button>
      </header>

      {/* ── Landing con los dos botones principales ── */}
      <div className="admin-dashboard">
        <div className="admin-landing-container">
          <div className="admin-shortcuts-grid">
            <button
              type="button"
              className={`admin-shortcut-card ${activeSection === 'cuentas' ? 'active' : ''}`}
              onClick={() => toggleSection('cuentas')}
            >
              <div className="shortcut-icon-wrapper accounts">
                <Users size={28} />
              </div>
              <div className="shortcut-copy">
                <h3>Cuentas</h3>
                <span className="shortcut-badge">{activeAccountsCount} activas</span>
              </div>
            </button>

            <button
              type="button"
              className={`admin-shortcut-card ${activeSection === 'productos' ? 'active' : ''}`}
              onClick={() => toggleSection('productos')}
            >
              <div className="shortcut-icon-wrapper products">
                <Package size={28} />
              </div>
              <div className="shortcut-copy">
                <h3>Productos</h3>
                <span className="shortcut-badge">{activeProductsCount} activos</span>
              </div>
            </button>
          </div>
        </div>

        {/* ── Sección de Cuentas (Subsección abajo) ── */}
        {activeSection === 'cuentas' && (
          <div className="admin-section-content">
            <div className="admin-actions-bar">
              <button type="button" className="primary small" onClick={() => setActiveModal({ type: 'create-account' })}>
                <Plus size={16} /> Crear Cuenta
              </button>
              <button type="button" className="primary small" onClick={() => setActiveModal({ type: 'create-user' })}>
                <Plus size={16} /> Crear Usuario
              </button>
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'payment' })}>
                <ReceiptText size={16} /> Registrar Cobro
              </button>
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'adjustment' })}>
                Ajuste Manual
              </button>
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'independize' })}>
                <Split size={16} /> Independizar
              </button>
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'history' })}>
                Ver Historial
              </button>
            </div>

            <div className="admin-list-card">
              <h2>Cuentas y Usuarios</h2>
              <div className="admin-accounts-list">
                {data.accounts
                  .filter((a) => a.status === 'active')
                  .map((account) => {
                    const balance = data.accountBalances.find((b) => b.accountId === account.id);
                    const users = data.users.filter((u) => u.accountId === account.id);
                    return (
                      <div key={account.id} className="admin-account-row-block">
                        <div className="admin-account-row-header">
                          <div>
                            <h3>{account.name}</h3>
                            <span className="account-balance-label">
                              Saldo: <strong>{formatMoney(balance?.balance ?? 0)}</strong>
                            </span>
                          </div>
                          <div className="admin-row-actions">
                            <button
                              type="button"
                              className="ghost small"
                              onClick={() => setActiveModal({ type: 'edit-account', target: account })}
                            >
                              Editar
                            </button>
                          </div>
                        </div>
                        <div className="admin-users-sublist">
                          {users.map((user) => {
                            const userBalance = balance?.users.find((u) => u.userId === user.id)?.balance ?? 0;
                            return (
                              <div key={user.id} className="admin-user-row">
                                <span>
                                  {user.name} <small className="muted">({user.status})</small>
                                </span>
                                <span className="user-row-balance">{formatMoney(userBalance)}</span>
                                <div className="admin-row-actions">
                                  <button
                                    type="button"
                                    className="ghost small"
                                    onClick={() => setActiveModal({ type: 'edit-user', target: user })}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost small"
                                    onClick={async () => {
                                      await adminApi.updateUser(
                                        { ...user, status: user.status === 'active' ? 'inactive' : 'active' },
                                        adminSession
                                      );
                                      onMessage('Estado de usuario actualizado.');
                                    }}
                                  >
                                    {user.status === 'active' ? 'Desactivar' : 'Activar'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* ── Sección de Productos (Subsección abajo) ── */}
        {activeSection === 'productos' && (
          <div className="admin-section-content">
            <div className="admin-actions-bar">
              <button type="button" className="primary small" onClick={() => setActiveModal({ type: 'create-product' })}>
                <Plus size={16} /> Crear Producto
              </button>
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'purchase' })}>
                <PackagePlus size={16} /> Registrar Compra
              </button>
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'stock-adjustment' })}>
                Ajuste de Stock
              </button>
              <button
                type="button"
                className="secondary small"
                onClick={async () => {
                  await adminApi.recalculateFifo({}, adminSession);
                  onMessage('Costos FIFO recalculados.');
                }}
              >
                <RefreshCw size={16} /> Recalcular FIFO
              </button>
            </div>

            <div className="admin-list-card">
              <h2>Catálogo e Inventario</h2>
              <div className="table-list">
                {data.products.map((product) => {
                  const stock = data.productStocks.find((s) => s.productId === product.id)?.stock ?? 0;
                  return (
                    <div key={product.id} className="table-row">
                      <div className="product-row-info">
                        <strong>{product.name}</strong>
                        <span className="category-tag">{product.category}</span>
                      </div>
                      <span>Venta: {formatMoney(product.price)}</span>
                      <span>Costo: {formatMoney(product.lastCost ?? 0)}</span>
                      <span className={stock <= product.stockMin ? 'danger-text' : ''}>
                        Stock: {stock} (Min {product.stockMin})
                      </span>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() => setActiveModal({ type: 'edit-product', target: product })}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ghost small"
                          onClick={async () => {
                            await adminApi.updateProduct(
                              { ...product, status: product.status === 'active' ? 'inactive' : 'active' },
                              adminSession
                            );
                            onMessage(product.status === 'active' ? 'Producto desactivado.' : 'Producto activado.');
                          }}
                        >
                          {product.status === 'active' ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modales de Acción ── */}
      {activeModal && (
        <AdminModalContainer
          modal={activeModal}
          data={data}
          onClose={() => setActiveModal(null)}
          onMessage={onMessage}
          adminSession={adminSession}
          onDataChanged={onRefresh}
        />
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   HeaderSyncWidget
   ═══════════════════════════════════════════════════════ */

export function AdminPanel({ data, onMessage, onLogout, online, adminSession, onRefresh, onChangePin }: AdminPanelProps) {
  const [activeSection, setActiveSection] = useState<AdminSection>('catalogo');
  const [activeModal, setActiveModal] = useState<ModalState>(null);
  const [productFilter, setProductFilter] = useState<ProductFilter>('all');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [accountView, setAccountView] = useState<AccountPanelTab>('accounts');
  const [userFilter, setUserFilter] = useState<UserFilter>('all');
  const [chargeView, setChargeView] = useState<ChargePanelTab>('receivables');
  const [productQuery, setProductQuery] = useState('');
  const [accountQuery, setAccountQuery] = useState('');
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  const activeAccountsCount = data.accounts.filter((a) => a.status === 'active').length;
  const activeProductsCount = data.products.filter((p) => p.status === 'active').length;
  const totalProductsCount = data.products.length;
  const inventorySummary = data.products.reduce(
    (summary, product) => {
      const stockProjection = data.productStocks.find((entry) => entry.productId === product.id);
      const stock = stockProjection?.stock ?? 0;
      const availableStock = Math.max(0, stock);
      return {
        units: summary.units + availableStock,
        value: summary.value + (stockProjection?.inventoryValue ?? availableStock * (product.lastCost ?? 0))
      };
    },
    { units: 0, value: 0 }
  );
  function toggleProductSelection(productId: string) {
    setSelectedProductIds((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]
    );
  }

  function openBulkAction(mode: BulkProductAction) {
    if (selectedProductIds.length === 0) return;
    setActiveModal({ type: 'bulk-products', target: { mode, productIds: selectedProductIds } });
  }

  function switchAdminSection(section: AdminSection) {
    setActiveSection(section);
    if (section !== 'catalogo') {
      setSelectedProductIds([]);
    }
  }

  const filteredProducts = useMemo(() => {
    const query = normalizeSearch(productQuery);
    return data.products
      .map((product) => ({ product, stock: productStock(data, product.id) }))
      .filter(({ product, stock }) => {
        const matchesQuery =
          !query ||
          normalizeSearch(product.name).includes(query) ||
          normalizeSearch(product.category).includes(query);
        const matchesFilter =
          productFilter === 'all' ||
          (productFilter === 'active' && product.status === 'active') ||
          (productFilter === 'inactive' && product.status === 'inactive') ||
          (productFilter === 'low' && product.status === 'active' && stock <= product.stockMin);
        return matchesQuery && matchesFilter;
      })
      .sort((a, b) => {
        if (a.product.status !== b.product.status) return a.product.status === 'active' ? -1 : 1;
        if (a.stock !== b.stock) return a.stock - b.stock;
        const priority = productPriority(a.product, a.stock) - productPriority(b.product, b.stock);
        if (priority !== 0) return priority;
        return a.product.name.localeCompare(b.product.name);
      });
  }, [data, productFilter, productQuery]);

  const filteredAccounts = useMemo(() => {
    const query = normalizeSearch(accountQuery);
    return data.accounts
      .map((account) => {
        const users = data.users.filter((user) => user.role === 'user' && user.accountId === account.id);
        const balance = data.accountBalances.find((entry) => entry.accountId === account.id);
        return { account, users, balance };
      })
      .filter(({ account, users, balance }) => {
        const matchesQuery =
          !query ||
          normalizeSearch(account.name).includes(query) ||
          users.some((user) => normalizeSearch(user.name).includes(query));
        const accountBalance = balance?.balance ?? 0;
        const matchesFilter =
          accountFilter === 'all' ||
          (accountFilter === 'debt' && account.status === 'active' && accountBalance > 0) ||
          (accountFilter === 'clear' && account.status === 'active' && accountBalance <= 0) ||
          (accountFilter === 'inactive' && account.status === 'inactive');
        return matchesQuery && matchesFilter;
      })
      .sort((a, b) => {
        if (a.account.status !== b.account.status) return a.account.status === 'active' ? -1 : 1;
        const balanceDiff = (b.balance?.balance ?? 0) - (a.balance?.balance ?? 0);
        if (balanceDiff !== 0) return balanceDiff;
        return a.account.name.localeCompare(b.account.name);
      });
  }, [accountFilter, accountQuery, data]);

  const userBalances = data.userBalances;

  const filteredUsers = useMemo(() => {
    const query = normalizeSearch(accountQuery);
    return data.users
      .filter((user) => user.role === 'user')
      .map((user) => {
        const account = data.accounts.find((entry) => entry.id === user.accountId);
        return { user, account };
      })
      .filter(({ user, account }) => {
        const matchesQuery =
          !query ||
          normalizeSearch(user.name).includes(query) ||
          normalizeSearch(account?.name ?? '').includes(query);
        const matchesFilter =
          userFilter === 'all' ||
          (userFilter === 'active' && user.status === 'active') ||
          (userFilter === 'inactive' && user.status === 'inactive');
        return matchesQuery && matchesFilter;
      })
      .sort((a, b) => {
        if (a.user.status !== b.user.status) return a.user.status === 'active' ? -1 : 1;
        return a.user.name.localeCompare(b.user.name);
      });
  }, [accountQuery, data, userFilter]);

  const chargeTargets = useMemo(() => {
    const accountTargets = data.accounts.map((account) => {
      const users = data.users.filter((user) => user.role === 'user' && user.accountId === account.id);
      const activeUsers = users.filter((user) => user.status === 'active');
      const balance = data.accountBalances.find((entry) => entry.accountId === account.id)?.balance ?? 0;
      return {
        id: account.id,
        type: 'account' as const,
        target: account,
        name: account.name,
        label: `${users.length} usuario${users.length === 1 ? '' : 's'}`,
        balance,
        status: account.status,
        disabled: account.status !== 'active' || activeUsers.length === 0 || balance <= 0
      };
    });

    const independentUserTargets = data.users
      .filter((user) => user.role === 'user' && !user.accountId)
      .map((user) => {
        const balance = userBalances.find((entry) => entry.userId === user.id)?.balance ?? 0;
        return {
          id: user.id,
          type: 'user' as const,
          target: user,
          name: user.name,
          label: 'Usuario sin cuenta',
          balance,
          status: user.status,
          disabled: user.status !== 'active' || balance <= 0
        };
      });

    return [...accountTargets, ...independentUserTargets].sort((a, b) => {
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
      if (b.balance !== a.balance) return b.balance - a.balance;
      if (a.type !== b.type) return a.type === 'account' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [data, userBalances]);

  const receivableTargets = chargeTargets.filter((entry) => entry.balance > 0);
  const totalDebt = receivableTargets.reduce((sum, entry) => sum + entry.balance, 0);
  const chargeHistory = useMemo(
    () =>
      data.payments
        .map((payment) => {
          const account = payment.accountId ? data.accounts.find((entry) => entry.id === payment.accountId) : undefined;
          const targetUser = payment.userId ? data.users.find((entry) => entry.id === payment.userId) : undefined;
          const payerUser = payment.paidByUserId ? data.users.find((entry) => entry.id === payment.paidByUserId) : undefined;
          return {
            payment,
            payerUser,
            targetName: payment.targetType === 'user' ? targetUser?.name ?? 'Usuario' : account?.name ?? 'Cuenta completa'
          };
        })
        .sort((a, b) => b.payment.createdAt.localeCompare(a.payment.createdAt)),
    [data]
  );
  const adjustmentHistory = useMemo(
    () =>
      data.adjustments
        .map((adjustment) => {
          const account = adjustment.accountId
            ? data.accounts.find((entry) => entry.id === adjustment.accountId)
            : undefined;
          const user = adjustment.userId
            ? data.users.find((entry) => entry.id === adjustment.userId)
            : undefined;
          return {
            adjustment,
            targetName: adjustment.scope === 'user' ? user?.name ?? 'Usuario' : account?.name ?? 'Cuenta'
          };
        })
        .sort((left, right) => right.adjustment.createdAt.localeCompare(left.adjustment.createdAt)),
    [data]
  );

  return (
    <section className={`admin-session ${activeSection === 'catalogo' && selectedProductIds.length > 0 ? 'has-bulk-bar' : ''}`}>
      <header className="kiosk-header">
        <div className="kiosk-brand-block">
          <div className="kiosk-logo" aria-hidden="true">
            <BrandLogo />
          </div>
          <div className="kiosk-brand-copy">
            <strong>Tienda</strong>
            <span>Administrador</span>
          </div>
        </div>

        <div className="admin-header-widgets">
          <HeaderSyncWidget
            online={online}
            pendingSync={data.pendingSync}
            onMessage={onMessage}
            onManualSync={
              onRefresh
                ? async () => {
                    await onRefresh();
                    return 'Datos de administrador actualizados.';
                  }
                : undefined
            }
          />
        </div>

        {onChangePin ? (
          <button
            className="ghost icon pin-action-button"
            onClick={() => setActiveModal({ type: 'change-pin' })}
            aria-label="Cambiar mi PIN"
            title="Cambiar mi PIN"
          >
            <KeyRound size={20} />
          </button>
        ) : null}
        <button className="ghost icon logout-button" onClick={onLogout} aria-label="Salir">
          <LogOut size={20} />
        </button>
      </header>

      <div className="admin-dashboard">
        <div className="admin-summary-strip" aria-label="Resumen del administrador">
          <div className="admin-summary-group money" aria-label="Resumen de dinero">
            <span className="admin-summary-group-label">Dinero</span>
            <div className="admin-summary-card debt">
              <ReceiptText size={20} />
              <strong>{formatMoney(totalDebt)}</strong>
              <span>Por cobrar</span>
            </div>
            <div className="admin-summary-card inventory">
              <DollarSign size={20} />
              <strong>{formatMoney(inventorySummary.value)}</strong>
              <span>Total inventario</span>
            </div>
          </div>
          <div className="admin-summary-group stock" aria-label="Resumen de productos">
            <span className="admin-summary-group-label">Productos</span>
            <div className="admin-summary-card products">
              <Package size={20} />
              <strong>{activeProductsCount} / {totalProductsCount}</strong>
              <span>Productos</span>
            </div>
            <div className="admin-summary-card units">
              <Boxes size={20} />
              <strong>{inventorySummary.units}</strong>
              <span>Unidades</span>
            </div>
          </div>
        </div>

        <div className="admin-global-actions" aria-label="Operaciones administrativas">
          <button type="button" className="ghost small" onClick={() => setActiveModal({ type: 'adjustment' })}>
            <DollarSign size={16} /> Ajustar saldo
          </button>
          <button type="button" className="ghost small" onClick={() => setActiveModal({ type: 'history' })}>
            <History size={16} /> Consumos
          </button>
          <button type="button" className="ghost small" onClick={() => setActiveModal({ type: 'inventory-history' })}>
            <Boxes size={16} /> Inventario
          </button>
        </div>

        <div className="admin-workspace">
          <div className="admin-shortcuts-grid admin-section-switcher" role="tablist" aria-label="Secciones admin">
            <button
              type="button"
              className={`admin-shortcut-card ${activeSection === 'catalogo' ? 'active' : ''}`}
              onClick={() => switchAdminSection('catalogo')}
              role="tab"
              aria-selected={activeSection === 'catalogo'}
            >
              <div className="shortcut-icon-wrapper products">
                <Package size={28} />
              </div>
              <div className="shortcut-copy">
                <h3>Catalogo</h3>
                <span className="shortcut-badge">{activeProductsCount} activos</span>
              </div>
            </button>

            <button
              type="button"
              className={`admin-shortcut-card ${activeSection === 'cuentas' ? 'active' : ''}`}
              onClick={() => switchAdminSection('cuentas')}
              role="tab"
              aria-selected={activeSection === 'cuentas'}
            >
              <div className="shortcut-icon-wrapper accounts">
                <Users size={28} />
              </div>
              <div className="shortcut-copy">
                <h3>Cuentas</h3>
                <span className="shortcut-badge">{activeAccountsCount} activas</span>
              </div>
            </button>

            <button
              type="button"
              className={`admin-shortcut-card ${activeSection === 'cobros' ? 'active' : ''}`}
              onClick={() => switchAdminSection('cobros')}
              role="tab"
              aria-selected={activeSection === 'cobros'}
            >
              <div className="shortcut-icon-wrapper accounts">
                <CreditCard size={28} />
              </div>
              <div className="shortcut-copy">
                <h3>Cobros</h3>
                <span className="shortcut-badge">{chargeTargets.length} destinos</span>
              </div>
            </button>

          </div>

          {activeSection === 'catalogo' && (
            <div className="admin-section-content">
              <div className="admin-list-toolbar">
                <label className="admin-search-field">
                  <Search size={18} />
                  <input
                    value={productQuery}
                    onChange={(event) => setProductQuery(event.target.value)}
                    placeholder="Buscar producto"
                  />
                </label>
                <div className="admin-filter-pills" aria-label="Filtros de catalogo">
                  {[
                    ['active', 'Activos'],
                    ['inactive', 'Desactivados'],
                    ['low', 'Bajo stock'],
                    ['all', 'Todos']
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={productFilter === value ? 'active' : ''}
                      onClick={() => setProductFilter(value as ProductFilter)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="admin-catalog-actions">
                <button type="button" className="admin-create-card-button" onClick={() => setActiveModal({ type: 'create-product' })}>
                  <span className="admin-create-card-icon" aria-hidden="true">
                    <Plus size={24} />
                  </span>
                  <span className="admin-create-card-copy">
                    <strong>Crear producto</strong>
                    <small>Agregar item al catalogo</small>
                  </span>
                </button>
                <span>Ordenado de menor a mayor stock</span>
              </div>

              <div className="admin-inventory-table" role="table" aria-label="Catalogo e inventario">
                <div className="admin-inventory-head" role="row">
                  <span>Producto</span>
                  <span>Valores</span>
                  <span>Acciones</span>
                </div>

                {filteredProducts.map(({ product, stock }) => {
                  const tone = productTone(product, stock);
                  const hasImage = product.imageUrl && !failedImages[product.id];
                  const isSelected = selectedProductIds.includes(product.id);
                  const subtotal = Math.max(0, stock) * product.price;
                  return (
                    <article
                      key={product.id}
                      className={`admin-inventory-row stock-${tone} ${isSelected ? 'selected' : ''}`}
                      role="row"
                    >
                      <div className="admin-inventory-product" role="cell">
                        <button
                          type="button"
                          className={`admin-inventory-thumb ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleProductSelection(product.id)}
                          aria-pressed={isSelected}
                          aria-label={`${isSelected ? 'Quitar seleccion' : 'Seleccionar'} ${product.name}`}
                        >
                          {hasImage ? (
                            <img
                              src={product.imageUrl}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={() => setFailedImages((prev) => ({ ...prev, [product.id]: true }))}
                            />
                          ) : (
                            <Package size={24} />
                          )}
                          {isSelected ? (
                            <span className="admin-inventory-selected" aria-hidden="true">
                              <CircleCheck size={15} />
                            </span>
                          ) : null}
                        </button>
                        <span className="admin-inventory-copy">
                          <span className="admin-inventory-title-line">
                            <strong title={product.name}>{product.name}</strong>
                          </span>
                          <small className="admin-inventory-category">{product.category}</small>
                        </span>
                      </div>

                      <div className="admin-inventory-metrics" role="cell">
                        <span className="admin-inventory-stock">
                          <span className="admin-inventory-stock-main">
                            <small>Stock</small>
                            <strong>{stock}</strong>
                          </span>
                          <span className={`admin-inventory-stock-meta inventory-${tone}`}>
                            {productStatusLabel(tone)}
                          </span>
                        </span>
                        <div className="admin-inventory-values">
                          <span>
                            <small>Venta</small>
                            <strong>{formatMoney(product.price)}</strong>
                          </span>
                          <span>
                            <small>Total</small>
                            <strong>{formatMoney(subtotal)}</strong>
                          </span>
                        </div>
                      </div>

                      <div className="admin-inventory-actions" role="cell">
                        <button
                          type="button"
                          className={`ghost icon admin-inventory-action admin-row-toggle ${
                            product.status === 'active' ? 'is-on' : 'is-off'
                          }`}
                          onClick={() => setActiveModal({ type: 'toggle-product-status', target: product })}
                          aria-label={product.status === 'active' ? `Desactivar ${product.name}` : `Activar ${product.name}`}
                          title={product.status === 'active' ? 'Activo' : 'Inactivo'}
                        >
                          {product.status === 'active' ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                        </button>
                        <button
                          type="button"
                          className="ghost icon admin-inventory-action"
                          onClick={() => setActiveModal({ type: 'edit-product', target: product })}
                          aria-label={`Modificar ${product.name}`}
                          title="Modificar"
                        >
                          <Edit size={17} />
                        </button>
                      </div>
                    </article>
                  );
                })}

                {filteredProducts.length === 0 ? (
                  <p className="admin-empty-state admin-catalog-empty">No hay productos que coincidan con este filtro.</p>
                ) : null}
              </div>
            </div>
          )}

          {activeSection === 'cuentas' && (
            <div className="admin-section-content">
              <div className="admin-accounts-control">
                <div className="admin-account-tabs" role="tablist" aria-label="Vista de cuentas">
                  <button
                    type="button"
                    className={accountView === 'accounts' ? 'active' : ''}
                    onClick={() => setAccountView('accounts')}
                    role="tab"
                    aria-selected={accountView === 'accounts'}
                  >
                    <Store size={16} /> Cuentas
                  </button>
                  <button
                    type="button"
                    className={accountView === 'users' ? 'active' : ''}
                    onClick={() => setAccountView('users')}
                    role="tab"
                    aria-selected={accountView === 'users'}
                  >
                    <Users size={16} /> Usuarios
                  </button>
                </div>
                <label className="admin-search-field">
                  <Search size={18} />
                  <input
                    value={accountQuery}
                    onChange={(event) => setAccountQuery(event.target.value)}
                    placeholder={accountView === 'accounts' ? 'Buscar cuenta o usuario' : 'Buscar usuario o cuenta'}
                  />
                </label>
              </div>

              <div className="admin-account-filter-row">
                {accountView === 'accounts' ? (
                  <div className="admin-filter-pills" aria-label="Filtros de cuentas">
                    {[
                      ['debt', 'Con deuda'],
                      ['clear', 'Al dia'],
                      ['inactive', 'Inactivas'],
                      ['all', 'Todas']
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={accountFilter === value ? 'active' : ''}
                        onClick={() => setAccountFilter(value as AccountFilter)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="admin-filter-pills" aria-label="Filtros de usuarios">
                    {[
                      ['active', 'Activos'],
                      ['inactive', 'Inactivos'],
                      ['all', 'Todos']
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={userFilter === value ? 'active' : ''}
                        onClick={() => setUserFilter(value as UserFilter)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className={`admin-smart-list admin-accounts-grid ${accountView === 'users' ? 'admin-users-list' : ''}`}>
                {accountView === 'accounts' ? (
                  <>
                    <button
                      type="button"
                      className="admin-account-item admin-account-panel admin-account-create-card"
                      onClick={() => setActiveModal({ type: 'create-account' })}
                    >
                      <span className="admin-create-card-icon" aria-hidden="true">
                        <Plus size={28} />
                      </span>
                      <span className="admin-create-card-copy">
                        <strong>Anadir cuenta</strong>
                        <small>Crear grupo, familia o cuenta independiente</small>
                      </span>
                    </button>

                    {filteredAccounts.map(({ account, users, balance }) => {
                      const accountBalance = balance?.balance ?? 0;
                      return (
                        <article
                          key={account.id}
                          className={`admin-account-item admin-account-panel ${
                            account.status === 'inactive' ? 'account-inactive' : accountBalance > 0 ? 'account-debt' : 'account-clear'
                          }`}
                        >
                          <div className="admin-account-panel-grid">
                            <div className="admin-account-identity">
                              <span className="admin-account-icon" aria-hidden="true">
                                <Store size={20} />
                              </span>
                              <div className="admin-item-main">
                                <div className="admin-item-title-row">
                                  <strong>{account.name}</strong>
                                  {account.status === 'inactive' ? <span className="status-pill muted">Inactiva</span> : null}
                                </div>
                                <div className="admin-item-metrics">
                                  <span>Ultimo mov. {latestAccountActivity(data, account.id)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="admin-account-users-summary">
                              <div className="admin-linked-users" aria-label={`Usuarios de ${account.name}`}>
                                {users.length > 0 ? (
                                  <>
                                    {users.slice(0, 5).map((user) => (
                                      <span className="admin-user-chip" key={user.id} title={user.name}>
                                        {initials(user.name)}
                                      </span>
                                    ))}
                                    {users.length > 5 ? <span className="admin-user-chip more">+{users.length - 5}</span> : null}
                                    <button
                                      type="button"
                                      className="admin-user-chip add"
                                      onClick={() => setActiveModal({ type: 'assign-user', target: account })}
                                      aria-label={`Agregar usuario a ${account.name}`}
                                      title="Agregar usuario"
                                    >
                                      <Plus size={15} />
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="admin-linked-users-empty add"
                                    onClick={() => setActiveModal({ type: 'assign-user', target: account })}
                                  >
                                    <Plus size={15} /> Usuario
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="admin-row-actions admin-panel-actions">
                              <button
                                type="button"
                                className="ghost small"
                                onClick={() => setActiveModal({ type: 'account-detail', target: account })}
                              >
                                <Eye size={15} /> Detalle
                              </button>
                              <button
                                type="button"
                                className="ghost small"
                                onClick={() => setActiveModal({ type: 'edit-account', target: account })}
                                title="Editar cuenta"
                              >
                                <Edit size={15} /> Editar
                              </button>
                              <button
                                type="button"
                                className={`ghost small admin-row-toggle ${account.status === 'active' ? 'is-on' : 'is-off'}`}
                                onClick={() => setActiveModal({ type: 'toggle-account-status', target: account })}
                                aria-label={account.status === 'active' ? `Desactivar ${account.name}` : `Activar ${account.name}`}
                                title={account.status === 'active' ? 'Activa' : 'Inactiva'}
                              >
                                {account.status === 'active' ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}

                    {filteredAccounts.length === 0 ? (
                      <p className="admin-empty-state">No hay cuentas que coincidan con este filtro.</p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="admin-account-item admin-user-item admin-account-create-card admin-user-create-card"
                      onClick={() => setActiveModal({ type: 'create-user' })}
                    >
                      <span className="admin-create-card-icon" aria-hidden="true">
                        <Plus size={24} />
                      </span>
                      <span className="admin-create-card-copy">
                        <strong>Anadir usuario</strong>
                        <small>Crear acceso para una persona</small>
                      </span>
                    </button>

                    {filteredUsers.map(({ user, account }) => (
                      <article
                        key={user.id}
                        className={`admin-account-item admin-user-item ${user.status === 'inactive' ? 'account-inactive' : ''}`}
                      >
                        <div className="admin-user-panel-grid">
                          <span className="admin-user-avatar" aria-hidden="true">
                            {initials(user.name)}
                          </span>
                          <div className="admin-item-main">
                            <div className="admin-item-title-row">
                              <strong>{user.name}</strong>
                              {user.status === 'inactive' ? <span className="status-pill muted">Inactivo</span> : null}
                            </div>
                            <div className="admin-item-metrics">
                              <span>{account?.name ?? 'Independiente'}</span>
                              <span>{latestUserActivity(data, user.id)}</span>
                            </div>
                          </div>
                          <div className="admin-user-side">
                            <div className="admin-row-actions admin-panel-actions">
                              <button
                                type="button"
                                className="ghost small"
                                onClick={() => setActiveModal({ type: 'edit-user', target: user })}
                              >
                                <Edit size={15} /> PIN
                              </button>
                              <button
                                type="button"
                                className={`ghost small admin-row-toggle ${user.status === 'active' ? 'is-on' : 'is-off'}`}
                                onClick={() => setActiveModal({ type: 'toggle-user-status', target: user })}
                                aria-label={user.status === 'active' ? `Desactivar ${user.name}` : `Activar ${user.name}`}
                                title={user.status === 'active' ? 'Activo' : 'Inactivo'}
                              >
                                {user.status === 'active' ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}

                    {filteredUsers.length === 0 ? (
                      <p className="admin-empty-state">No hay usuarios que coincidan con este filtro.</p>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}

          {activeSection === 'cobros' && (
            <div className="admin-section-content">
              <div className="admin-charge-tabs-row">
                <div className="admin-account-tabs" role="tablist" aria-label="Vista de cobros">
                  <button
                    type="button"
                    className={chargeView === 'receivables' ? 'active' : ''}
                    onClick={() => setChargeView('receivables')}
                    role="tab"
                    aria-selected={chargeView === 'receivables'}
                  >
                    <DollarSign size={16} /> Por cobrar
                  </button>
                  <button
                    type="button"
                    className={chargeView === 'history' ? 'active' : ''}
                    onClick={() => setChargeView('history')}
                    role="tab"
                    aria-selected={chargeView === 'history'}
                  >
                    <ReceiptText size={16} /> Historial
                  </button>
                </div>
              </div>

              {chargeView === 'receivables' ? (
                <div className="admin-smart-list admin-charge-list">
                  {receivableTargets.map((entry) => (
                    <article
                      key={`${entry.type}-${entry.id}`}
                      className={`admin-account-item admin-charge-item ${entry.status === 'inactive' ? 'account-inactive' : entry.balance > 0 ? 'account-debt' : 'account-clear'}`}
                    >
                      <span className="admin-account-icon" aria-hidden="true">
                        {entry.type === 'account' ? <Users size={20} /> : <User size={20} />}
                      </span>

                      <div className="admin-item-main">
                        <div className="admin-item-title-row">
                          <strong>{entry.name}</strong>
                          <span className="status-pill muted">{entry.type === 'account' ? 'Cuenta' : 'Usuario'}</span>
                          {entry.status === 'inactive' ? <span className="status-pill muted">Inactivo</span> : null}
                        </div>
                        <div className="admin-item-metrics">
                          <span>{entry.label}</span>
                        </div>
                      </div>

                      <div className={`admin-balance-focus ${entry.balance > 0 ? 'debt' : 'clear'}`}>
                        <span>Saldo</span>
                        <strong>{formatMoney(entry.balance)}</strong>
                      </div>

                      <button
                        type="button"
                        className="primary small admin-charge-pay"
                        onClick={() => setActiveModal({ type: 'payment', target: entry.target })}
                        disabled={entry.disabled}
                        title={entry.disabled ? 'No disponible para cobro' : 'Registrar cobro'}
                        aria-label={entry.disabled ? `No disponible para cobro de ${entry.name}` : `Registrar cobro de ${entry.name}`}
                      >
                        <CreditCard size={18} />
                      </button>
                    </article>
                  ))}
                  {receivableTargets.length === 0 ? (
                    <p className="admin-empty-state">No hay saldos por cobrar.</p>
                  ) : null}
                </div>
              ) : (
                <div className="admin-charge-history-list">
                  {chargeHistory.map(({ payment, payerUser, targetName }) => (
                    <article className="payment-card admin-charge-history-card" key={payment.id}>
                      <span className="payment-icon">
                        <CreditCard size={18} />
                      </span>
                      <div className="payment-card-copy">
                        <strong>{targetName}</strong>
                        <span>{formatCompactDate(payment.createdAt)}</span>
                        {payerUser ? <small>Pago {payerUser.name}</small> : null}
                      </div>
                      <strong className="payment-amount">+ {formatMoney(payment.amount)}</strong>
                      {payment.reversedMovementId ? (
                        <span className="status-pill muted">Reversado</span>
                      ) : (
                        <button
                          type="button"
                          className="ghost icon danger"
                          title="Reversar pago"
                          aria-label={`Reversar pago a ${targetName}`}
                          onClick={() => setActiveModal({ type: 'reverse-payment', target: payment })}
                        >
                          <Undo2 size={17} />
                        </button>
                      )}
                    </article>
                  ))}
                  {adjustmentHistory.map(({ adjustment, targetName }) => (
                    <article className="payment-card admin-charge-history-card" key={adjustment.id}>
                      <span className="payment-icon">
                        <DollarSign size={18} />
                      </span>
                      <div className="payment-card-copy">
                        <strong>
                          {adjustment.movementType === 'adjustment_reversal' ? 'Reverso de ajuste' : `Ajuste · ${targetName}`}
                        </strong>
                        <span>{formatCompactDate(adjustment.createdAt)}</span>
                        <small>{adjustment.note}</small>
                      </div>
                      <strong className="payment-amount">
                        {adjustment.amount >= 0 ? '+ ' : '- '}{formatMoney(Math.abs(adjustment.amount))}
                      </strong>
                      {adjustment.movementType === 'adjustment_reversal' ? (
                        <span className="status-pill muted">Reverso</span>
                      ) : adjustment.reversedByMovementId ? (
                        <span className="status-pill muted">Reversado</span>
                      ) : (
                        <button
                          type="button"
                          className="ghost icon danger"
                          title="Reversar ajuste"
                          aria-label={`Reversar ajuste de ${targetName}`}
                          onClick={() => setActiveModal({ type: 'reverse-adjustment', target: adjustment })}
                        >
                          <Undo2 size={17} />
                        </button>
                      )}
                    </article>
                  ))}
                  {chargeHistory.length === 0 && adjustmentHistory.length === 0 ? (
                    <p className="admin-empty-state">No hay cobros ni ajustes registrados.</p>
                  ) : null}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {activeSection === 'catalogo' && selectedProductIds.length > 0 ? (
        <div
          className="admin-bulk-fab"
          aria-label={`${selectedProductIds.length} producto${selectedProductIds.length === 1 ? '' : 's'} seleccionado${selectedProductIds.length === 1 ? '' : 's'}`}
        >
          <div className="admin-bulk-fab-menu">
            <button type="button" onClick={() => openBulkAction('purchase')} aria-label="Registrar compra">
              <PackagePlus size={18} />
              <span>Compra</span>
            </button>
            <button type="button" onClick={() => openBulkAction('inventory')} aria-label="Cuadre de inventario">
              <Boxes size={18} />
              <span>Inventario</span>
            </button>
            <button type="button" onClick={() => openBulkAction('prices')} aria-label="Actualizar precios">
              <DollarSign size={18} />
              <span>Precio</span>
            </button>
            <button
              type="button"
              className="admin-bulk-fab-clear"
              onClick={() => setSelectedProductIds([])}
              aria-label="Limpiar seleccion"
            >
              <BrushCleaning size={18} />
              <span>Limpiar</span>
            </button>
          </div>
          <div
            className="admin-bulk-fab-main"
            aria-live="polite"
            aria-label={`${selectedProductIds.length} productos seleccionados`}
          >
            <strong>{selectedProductIds.length}</strong>
          </div>
        </div>
      ) : null}

      {activeModal && (
        <AdminModalContainer
          modal={activeModal}
          data={data}
          onClose={() => setActiveModal(null)}
          onSwitchModal={setActiveModal}
          onBulkComplete={() => setSelectedProductIds([])}
          onMessage={onMessage}
          adminSession={adminSession}
          onDataChanged={onRefresh}
          onChangePin={onChangePin}
        />
      )}
    </section>
  );
}

interface HeaderSyncWidgetProps {
  online: boolean;
  pendingSync: number;
  onMessage: (message: string) => void;
  onManualSync?: () => Promise<string>;
}

function HeaderSyncWidget({ online, pendingSync, onMessage, onManualSync }: HeaderSyncWidgetProps) {
  const [syncing, setSyncing] = useState(false);
  const syncConfigured = isSyncConfigured();

  async function handleSync() {
    if (syncing || !online || !syncConfigured || !onManualSync) return;
    setSyncing(true);
    try {
      onMessage(await onManualSync());
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'No se pudieron actualizar los datos.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="header-sync-widget">
      <span
        className={`sync-status-icon ${online ? 'online' : 'offline'}`}
        title={online ? 'Administración conectada a Supabase' : 'Administración sin conexión'}
      >
        {online ? <Cloud size={18} /> : <CloudOff size={18} />}
      </span>

      <button
        type="button"
        className={`sync-action-btn ${pendingSync > 0 ? 'has-pending' : ''} ${syncing ? 'is-syncing' : ''}`}
        onClick={handleSync}
        disabled={!online || syncing || !syncConfigured || !onManualSync}
        title={
          !syncConfigured
            ? 'Supabase no está configurado'
            : pendingSync > 0
              ? `${pendingSync} operación pendiente. Haz clic para actualizar.`
              : 'Actualizar datos oficiales desde Supabase'
        }
      >
        <RefreshCw size={16} />
        {pendingSync > 0 && <span className="sync-badge">{pendingSync}</span>}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   AdminModalContainer — Desglose de Modales
   ═══════════════════════════════════════════════════════ */

interface AdminModalContainerProps {
  modal: { type: string; target?: any };
  data: TiendaData;
  onClose: () => void;
  onSwitchModal?: (modal: ModalState) => void;
  onBulkComplete?: () => void;
  onMessage: (message: string) => void;
  adminSession?: AppSession;
  onDataChanged?: () => Promise<void>;
  onChangePin?: (currentPin: string, newPin: string) => Promise<void>;
}

function AdminModalContainer({
  modal,
  data,
  onClose,
  onSwitchModal,
  onBulkComplete,
  onMessage,
  adminSession,
  onDataChanged,
  onChangePin
}: AdminModalContainerProps) {
  useBodyScrollLock(true);

  const activeAccounts = data.accounts.filter((a) => a.status === 'active');
  const activeUsers = data.users.filter((u) => u.role === 'user' && u.status === 'active');
  const unassignedUsers = activeUsers.filter((u) => !u.accountId);
  const modalTargetId = typeof modal.target?.id === 'string' ? modal.target.id : '';
  const modalTargetIsUser = data.users.some((entry) => entry.role === 'user' && entry.id === modalTargetId);
  const modalTargetIsAccount = data.accounts.some((entry) => entry.id === modalTargetId);
  const targetAccountId =
    typeof modal.target?.accountId === 'string'
      ? modal.target.accountId
      : modal.type === 'payment' && modalTargetIsUser
        ? ''
      : typeof modal.target?.id === 'string' && ['payment', 'adjustment', 'account-detail', 'merge'].includes(modal.type)
        ? modal.target.id
        : data.accounts[0]?.id ?? '';
  const targetUserId = modalTargetIsUser && typeof modal.target?.id === 'string' ? modal.target.id : '';
  const targetProductId =
    typeof modal.target?.id === 'string' && ['purchase', 'stock-adjustment'].includes(modal.type)
      ? modal.target.id
      : data.products.find((p) => p.status === 'active')?.id ?? '';

  // Registrar pago
  const [paymentAccount, setPaymentAccount] = useState(targetAccountId);
  const [paymentTargetType, setPaymentTargetType] = useState(
    modal.type === 'payment' && modalTargetIsUser ? 'user' : 'account'
  );
  const [paymentUserId, setPaymentUserId] = useState(targetUserId);
  const paymentUsers =
    paymentTargetType === 'account'
      ? activeUsers.filter((u) => u.accountId === paymentAccount)
      : activeUsers;
  const paymentPayers = paymentTargetType === 'account' ? paymentUsers : activeUsers;
  const fixedPaymentTarget = modal.type === 'payment' && (modalTargetIsAccount || modalTargetIsUser);
  const fixedPaymentBalance = (() => {
    if (modal.type !== 'payment') return 0;
    if (modalTargetIsAccount && typeof modal.target?.id === 'string') {
      return data.accountBalances.find((entry) => entry.accountId === modal.target.id)?.balance ?? 0;
    }
    if (modalTargetIsUser && typeof modal.target?.id === 'string') {
      return data.userBalances.find((entry) => entry.userId === modal.target.id)?.balance ?? 0;
    }
    return 0;
  })();
  const fixedPaymentAmount = fixedPaymentBalance > 0 ? String(fixedPaymentBalance) : '';
  const paymentOpenConsumptions =
    modal.type === 'payment' && fixedPaymentTarget && typeof modal.target?.id === 'string'
      ? calculateOpenConsumptions({
          userIds: modalTargetIsAccount
            ? activeUsers.filter((user) => user.accountId === modal.target.id).map((user) => user.id)
            : undefined,
          userId: modalTargetIsUser ? modal.target.id : undefined,
          consumptions: data.consumptions,
          applications: data.applications
        })
      : [];
  const paymentOpenTotal = paymentOpenConsumptions.reduce((sum, consumption) => sum + consumption.openAmount, 0);
  const paymentCarryoverBalance = Math.max(0, roundMoney(fixedPaymentBalance - paymentOpenTotal));
  const shouldShowPaymentCheckout =
    modal.type === 'payment' &&
    fixedPaymentTarget &&
    fixedPaymentBalance > 0 &&
    (paymentOpenConsumptions.length > 0 || paymentCarryoverBalance > 0);

  // Ajuste manual
  const [adjAccount, setAdjAccount] = useState(targetAccountId);
  const [adjScope, setAdjScope] = useState(
    modal.type === 'adjustment' && (modalTargetIsUser || activeAccounts.length === 0) ? 'user' : 'account'
  );
  const [adjUserId, setAdjUserId] = useState(
    modal.type === 'adjustment' && modalTargetIsUser ? modalTargetId : activeUsers[0]?.id ?? ''
  );
  const adjUsers = activeUsers;
  const [selectedProductId, setSelectedProductId] = useState(targetProductId);
  const [productImageDraft, setProductImageDraft] = useState(
    modal.type === 'edit-product' ? (modal.target?.imageUrl ?? '') : ''
  );
  const [bulkFailedImages, setBulkFailedImages] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const [detailAccountTab, setDetailAccountTab] = useState<AdminAccountDetailTab>('history');
  const [detailAccountFilter, setDetailAccountFilter] = useState('all');
  const bulkMode = modal.type === 'bulk-products' ? (modal.target?.mode as BulkProductAction | undefined) : undefined;
  const bulkProductIds = modal.type === 'bulk-products' && Array.isArray(modal.target?.productIds)
    ? (modal.target.productIds as string[])
    : [];
  const bulkProducts = bulkProductIds
    .map((id) => data.products.find((product) => product.id === id))
    .filter(Boolean) as Product[];

  function requestKey(suffix = modal.type): string {
    return `${operationId}:${suffix}`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      switch (modal.type) {
        case 'change-pin':
          if (!onChangePin) throw new Error('El cambio de PIN no está disponible.');
          const currentPin = String(form.get('currentPin') ?? '');
          const requestedPin = String(form.get('newPin') ?? '');
          const confirmedPin = String(form.get('confirmPin') ?? '');
          if (!/^\d{4,8}$/.test(requestedPin)) throw new Error('El nuevo PIN debe tener entre 4 y 8 dígitos.');
          if (requestedPin !== confirmedPin) throw new Error('La confirmación del nuevo PIN no coincide.');
          await onChangePin(currentPin, requestedPin);
          onMessage('Tu PIN administrativo fue actualizado.');
          break;

        case 'create-account':
          const createdAccount = await adminApi.createAccount(
            {
              name: String(form.get('name') ?? ''),
              userIds: form.getAll('userIds').map(String)
            },
            adminSession,
            requestKey('create-account')
          );
          const assignedCount = createdAccount.assignedUserIds?.length ?? 0;
          onMessage(
            assignedCount > 0
              ? `Cuenta creada con ${assignedCount} usuario${assignedCount === 1 ? '' : 's'}.`
              : 'Cuenta creada.'
          );
          break;

        case 'create-user':
          const newUserAccountId = String(form.get('accountId') ?? '').trim();
          await adminApi.createUser({
            accountId: newUserAccountId || undefined,
            name: String(form.get('name') ?? ''),
            username: String(form.get('username') ?? '').trim() || undefined,
            pin: String(form.get('pin') ?? '')
          }, adminSession, requestKey('create-user'));
          onMessage('Usuario creado.');
          break;

        case 'assign-user':
          const assignedUserId = String(form.get('userId') ?? '');
          const assignedUser = data.users.find((entry) => entry.id === assignedUserId);
          await adminApi.assignUserToAccount(
            assignedUserId,
            String(form.get('accountId') ?? modal.target?.id ?? ''),
            adminSession,
            requestKey('assign-user'),
            assignedUser?.version
          );
          onMessage('Usuario agregado a la cuenta.');
          break;

        case 'remove-user-account':
          await adminApi.removeUserFromAccount(
            String(modal.target.id),
            adminSession,
            requestKey('remove-user-account'),
            Number(modal.target.version) || undefined
          );
          onMessage('Usuario removido de la cuenta.');
          break;

        case 'move-user':
          const movedUserId = String(form.get('userId') ?? '');
          const movedUser = data.users.find((entry) => entry.id === movedUserId);
          const destinationAccountId = String(form.get('accountId') ?? '');
          if (destinationAccountId) {
            await adminApi.assignUserToAccount(
              movedUserId,
              destinationAccountId,
              adminSession,
              requestKey('move-user'),
              movedUser?.version
            );
          } else {
            await adminApi.removeUserFromAccount(
              movedUserId,
              adminSession,
              requestKey('move-user'),
              movedUser?.version
            );
          }
          onMessage('Pertenencia del usuario actualizada; su saldo lo acompaña.');
          break;

        case 'payment':
          const paymentUserIdValue = paymentTargetType === 'user' ? String(form.get('userId') ?? '') : undefined;
          const paymentUser = paymentUserIdValue ? activeUsers.find((user) => user.id === paymentUserIdValue) : undefined;
          await adminApi.createPayment({
            accountId:
              paymentTargetType === 'account'
                ? String(form.get('accountId') ?? '')
                : paymentUser?.accountId,
            targetType: paymentTargetType === 'user' ? 'user' : 'account',
            userId: paymentUserIdValue,
            paidByUserId: String(form.get('paidByUserId') ?? ''),
            amount: toNumber(form.get('amount')),
            note: String(form.get('note') ?? '')
          }, adminSession, requestKey('payment'));
          onMessage('Cobro registrado.');
          break;

        case 'reverse-payment':
          await adminApi.reverseFinancialMovement(
            String(modal.target?.id ?? ''),
            String(form.get('reason') ?? ''),
            adminSession,
            requestKey('reverse-payment')
          );
          onMessage('Pago reversado. Las compras asociadas quedaron abiertas nuevamente.');
          break;

        case 'reverse-adjustment':
          await adminApi.reverseFinancialMovement(
            String(modal.target?.id ?? ''),
            String(form.get('reason') ?? ''),
            adminSession,
            requestKey('reverse-adjustment')
          );
          onMessage('Ajuste reversado mediante un movimiento financiero inverso.');
          break;

        case 'void-consumption':
          await adminApi.voidConsumption(
            String(modal.target?.id ?? ''),
            String(form.get('reason') ?? ''),
            adminSession,
            requestKey('void-consumption')
          );
          onMessage('Consumo anulado y existencias restauradas.');
          break;

        case 'adjustment':
          const adjustmentUser = adjScope === 'user'
            ? activeUsers.find((user) => user.id === String(form.get('userId') ?? adjUserId))
            : undefined;
          await adminApi.createBalanceAdjustment({
            accountId: adjScope === 'user'
              ? adjustmentUser?.accountId
              : String(form.get('accountId') ?? adjAccount),
            scope: adjScope === 'user' ? 'user' : 'account',
            userId: adjScope === 'user' ? adjustmentUser?.id : undefined,
            amount: Number(form.get('amount')),
            note: String(form.get('note') ?? '')
          }, adminSession, requestKey('adjustment'));
          onMessage('Ajuste registrado.');
          break;

        case 'independize':
          const independentUserId = String(form.get('userId'));
          const independentUser = data.users.find((entry) => entry.id === independentUserId);
          await adminApi.independizeUser(
            independentUserId,
            String(form.get('newAccountName') ?? ''),
            adminSession,
            requestKey('independize'),
            independentUser?.version
          );
          onMessage('Usuario independizado.');
          break;

        case 'merge':
          await adminApi.mergeAccounts(
            String(form.get('sourceAccountId')),
            String(form.get('targetAccountId')),
            adminSession,
            requestKey('merge')
          );
          onMessage('Cuentas unidas.');
          break;

        case 'create-product':
          await adminApi.createProduct({
            name: String(form.get('name') ?? ''),
            category: String(form.get('category') ?? ''),
            price: 0,
            stockMin: 0,
            lastCost: 0,
            imageUrl: String(form.get('imageUrl') ?? '')
          }, adminSession, requestKey('create-product'));
          onMessage('Producto creado.');
          break;

        case 'purchase':
          await adminApi.createPurchase({
            productId: String(form.get('productId')),
            quantity: toNumber(form.get('quantity')),
            unitCost: toNumber(form.get('unitCost')),
            note: String(form.get('note') ?? '')
          }, adminSession, requestKey('purchase'));
          onMessage('Compra registrada.');
          break;

        case 'stock-adjustment':
          await adminApi.adjustInventory({
            productId: String(form.get('productId')),
            quantityDelta: Number(form.get('quantityDelta')),
            note: String(form.get('note') ?? '')
          }, adminSession, requestKey('stock-adjustment'));
          onMessage('Stock ajustado.');
          break;

        case 'reverse-inventory':
          await adminApi.reverseInventoryMovement(
            String(modal.target?.id ?? ''),
            String(form.get('reason') ?? ''),
            adminSession,
            requestKey(`reverse-inventory-${String(modal.target?.id ?? '')}`)
          );
          onMessage('Movimiento de inventario reversado.');
          break;

        case 'edit-account':
          await adminApi.updateAccount(
            { ...modal.target, name: String(form.get('name') ?? '') },
            adminSession,
            requestKey('edit-account')
          );
          onMessage('Cuenta actualizada.');
          break;

        case 'edit-user':
          const newPin = String(form.get('pin') ?? '').trim();
          await adminApi.updateUser(
            {
              ...modal.target,
              name: String(form.get('name') ?? modal.target.name),
              username: String(form.get('username') ?? modal.target.username).trim() || modal.target.username,
              newPin: newPin || undefined
            },
            adminSession,
            requestKey('edit-user')
          );
          onMessage('Usuario actualizado.');
          break;

        case 'edit-product':
          await adminApi.updateProduct(
            {
              ...modal.target,
              name: String(form.get('name') ?? ''),
              price: toNumber(form.get('price')),
              category: String(form.get('category') ?? ''),
              stockMin: toNumber(form.get('stockMin')),
              imageUrl: String(form.get('imageUrl') ?? '')
            },
            adminSession,
            requestKey('edit-product')
          );
          onMessage('Producto actualizado.');
          break;

        case 'toggle-product-status':
          await adminApi.setProductStatus(
            String(modal.target.id),
            modal.target.status === 'active' ? 'inactive' : 'active',
            String(form.get('reason') ?? ''),
            adminSession,
            requestKey('toggle-product-status')
          );
          onMessage(modal.target.status === 'active' ? 'Producto desactivado.' : 'Producto activado.');
          break;

        case 'toggle-user-status':
          await adminApi.setUserStatus(
            String(modal.target.id),
            modal.target.status === 'active' ? 'inactive' : 'active',
            String(form.get('reason') ?? ''),
            adminSession,
            requestKey('toggle-user-status')
          );
          onMessage(modal.target.status === 'active' ? 'Usuario desactivado.' : 'Usuario activado.');
          break;

        case 'toggle-account-status':
          await adminApi.setAccountStatus(
            String(modal.target.id),
            modal.target.status === 'active' ? 'inactive' : 'active',
            String(form.get('reason') ?? ''),
            adminSession,
            requestKey('toggle-account-status')
          );
          onMessage(modal.target.status === 'active' ? 'Cuenta desactivada.' : 'Cuenta activada.');
          break;

        case 'bulk-products':
          const bulkItems: Array<Record<string, unknown>> = [];
          if (bulkMode === 'purchase') {
            for (const product of bulkProducts) {
              const quantity = toNumber(form.get(`quantity-${product.id}`));
              if (quantity <= 0) continue;
              bulkItems.push({
                productId: product.id,
                quantity,
                unitCost: toNumber(form.get(`unitCost-${product.id}`)),
                note: String(form.get(`note-${product.id}`) ?? '')
              });
            }
          }

          if (bulkMode === 'inventory') {
            for (const product of bulkProducts) {
              const stockCountInput = form.get(`stockCount-${product.id}`);
              const stockCountText = typeof stockCountInput === 'string' ? stockCountInput.trim() : '';
              if (!stockCountText) continue;

              const countedStock = Number(stockCountText);
              if (!Number.isFinite(countedStock) || countedStock < 0) {
                throw new Error(`Conteo inválido para ${product.name}.`);
              }

              const currentStock = productStock(data, product.id);
              const quantityDelta = countedStock - currentStock;
              if (!Number.isFinite(quantityDelta) || quantityDelta === 0) continue;
              bulkItems.push({
                productId: product.id,
                quantityDelta,
                note: String(
                  form.get(`note-${product.id}`) ??
                    `Cuadre de inventario: conteo ${countedStock}, sistema ${currentStock}`
                )
              });
            }
          }

          if (bulkMode === 'prices') {
            for (const product of bulkProducts) {
              bulkItems.push({
                productId: product.id,
                price: toNumber(form.get(`price-${product.id}`)),
                version: product.version
              });
            }
          }

          if (!bulkMode) throw new Error('Selecciona una operación masiva válida.');
          const bulkResult = await adminApi.applyBulkProductOperation(
            bulkMode,
            bulkItems,
            adminSession,
            requestKey('bulk-products')
          );
          onMessage(
            `${bulkResult.count} cambio${bulkResult.count === 1 ? '' : 's'} aplicado${bulkResult.count === 1 ? '' : 's'} en una sola transacción.`
          );

          onBulkComplete?.();
          break;
      }
      if (onDataChanged) {
        try {
          await onDataChanged();
        } catch (refreshError) {
          onMessage(
            refreshError instanceof Error
              ? `La operación se guardó, pero la vista no pudo actualizarse: ${refreshError.message}`
              : 'La operación se guardó, pero la vista no pudo actualizarse.'
          );
        }
      }
      onClose();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Error en la operación.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleProductImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onMessage('Selecciona un archivo de imagen.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProductImageDraft(reader.result);
      }
    };
    reader.onerror = () => onMessage('No se pudo cargar la imagen.');
    reader.readAsDataURL(file);
  }

  const detailAccount = modal.type === 'account-detail' ? (modal.target as Account) : undefined;
  const detailBalance = detailAccount
    ? data.accountBalances.find((entry) => entry.accountId === detailAccount.id)
    : undefined;
  const detailUsers = detailAccount
    ? data.users.filter((user) => user.role === 'user' && user.accountId === detailAccount.id)
    : [];
  const detailUserIds = new Set(detailUsers.map((user) => user.id));
  const effectiveDetailAccountFilter =
    detailAccountFilter === 'all' || detailUserIds.has(detailAccountFilter) ? detailAccountFilter : 'all';
  const detailConsumptions = detailAccount
    ? data.consumptions
        .filter((entry) => detailUserIds.has(entry.userId))
        .filter((entry) => effectiveDetailAccountFilter === 'all' || entry.userId === effectiveDetailAccountFilter)
        .slice(0, 18)
    : [];
  const detailPayments = detailAccount
    ? data.payments
        .filter(
          (payment) =>
            detailUserIds.has(payment.userId ?? '') ||
            detailUserIds.has(payment.paidByUserId ?? '') ||
            payment.accountId === detailAccount.id
        )
        .filter(
          (payment) =>
            effectiveDetailAccountFilter === 'all' ||
            payment.userId === effectiveDetailAccountFilter ||
            payment.paidByUserId === effectiveDetailAccountFilter
        )
        .slice(0, 18)
    : [];
  const groupedDetailConsumptions = groupByDay(detailConsumptions);
  const groupedDetailPayments = groupByDay(detailPayments);
  const reversedInventoryMovementIds = new Set(
    data.movements
      .map((movement) => movement.reversedMovementId)
      .filter((id): id is string => Boolean(id))
  );
  const inventoryHistory = [...data.movements]
    .filter((movement) => ['purchase', 'adjustment', 'adjustment_reversal'].includes(movement.movementType))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <div className="modal-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Operación administrativa"
        className={
          modal.type === 'account-detail'
            ? 'modal account-modal admin-account-detail-modal'
            : `modal admin-action-modal ${modal.type === 'bulk-products' ? 'wide admin-bulk-modal' : ''} ${modal.type === 'payment' ? 'admin-payment-modal' : ''}`
        }
      >
        {modal.type !== 'account-detail' ? (
          <div className="admin-modal-title-row">
            <h2>
              {modal.type === 'change-pin' && 'Cambiar mi PIN'}
              {modal.type === 'create-account' && 'Crear Nueva Cuenta'}
              {modal.type === 'create-user' && 'Crear Nuevo Usuario'}
              {modal.type === 'payment' && 'Registrar Cobro'}
              {modal.type === 'reverse-payment' && 'Reversar Pago'}
              {modal.type === 'reverse-adjustment' && 'Reversar Ajuste'}
              {modal.type === 'void-consumption' && 'Anular Consumo'}
              {modal.type === 'reverse-inventory' && 'Reversar Movimiento de Inventario'}
              {modal.type === 'assign-user' && 'Agregar Usuario a Cuenta'}
              {modal.type === 'adjustment' && 'Realizar Ajuste Manual'}
              {modal.type === 'independize' && 'Independizar Usuario'}
              {modal.type === 'merge' && 'Unir Cuentas'}
              {modal.type === 'create-product' && 'Agregar Producto'}
              {modal.type === 'purchase' && 'Registrar Compra / Inventario'}
              {modal.type === 'stock-adjustment' && 'Ajuste de Stock'}
              {modal.type === 'edit-account' && 'Editar Cuenta'}
              {modal.type === 'edit-user' && 'Editar Usuario'}
              {modal.type === 'edit-product' && 'Editar Producto'}
              {modal.type === 'history' && 'Historial de Consumos'}
              {modal.type === 'inventory-history' && 'Movimientos de Inventario'}
              {modal.type === 'toggle-account-status' &&
                (modal.target.status === 'active' ? 'Desactivar Cuenta' : 'Activar Cuenta')}
              {modal.type === 'toggle-product-status' &&
                (modal.target.status === 'active' ? 'Desactivar Producto' : 'Activar Producto')}
              {modal.type === 'toggle-user-status' &&
                (modal.target.status === 'active' ? 'Desactivar Usuario' : 'Activar Usuario')}
              {modal.type === 'remove-user-account' && 'Quitar Usuario de Cuenta'}
              {modal.type === 'move-user' && 'Mover Usuario'}
              {modal.type === 'bulk-products' && bulkMode === 'purchase' && 'Compra de Productos'}
              {modal.type === 'bulk-products' && bulkMode === 'inventory' && 'Cuadre de Inventario'}
              {modal.type === 'bulk-products' && bulkMode === 'prices' && 'Actualizar Precios'}
            </h2>
            <button type="button" className="close-btn" onClick={onClose} aria-label="Cerrar">
              <X size={20} />
            </button>
          </div>
        ) : null}

        {modal.type === 'account-detail' && detailAccount ? (
          <>
            <div className="account-modal-hero">
              <div className="account-modal-title">
                <span>Estado de cuenta</span>
                <h2>{detailAccount.name}</h2>
                <p>
                  <Users size={15} />
                  {detailUsers.length} usuario{detailUsers.length === 1 ? '' : 's'} asociado{detailUsers.length === 1 ? '' : 's'}
                </p>
              </div>

              <button type="button" className="account-close-button" onClick={onClose} aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>

            <section className="account-balance-stack admin-account-balance-stack" aria-label="Filtrar cuenta">
              <div className="account-balance-heading">
                <span>Subtotales por usuario</span>
                <small>Toca una fila para filtrar</small>
              </div>

              {detailUsers.map((user) => {
                const userBalance = detailBalance?.users.find((entry) => entry.userId === user.id)?.balance ?? 0;
                return (
                  <div
                    key={user.id}
                    className={effectiveDetailAccountFilter === user.id ? 'account-balance-row account-member-row active' : 'account-balance-row account-member-row'}
                  >
                    <button type="button" className="account-balance-filter-button" onClick={() => setDetailAccountFilter(user.id)}>
                      <span className="account-avatar">{initials(user.name)}</span>
                      <span className="account-balance-copy">
                        <strong>{user.name}</strong>
                        <small>{user.status === 'active' ? 'Usuario asociado' : 'Usuario inactivo'}</small>
                      </span>
                      <strong className="account-balance-amount">{formatMoney(userBalance)}</strong>
                    </button>
                    <button
                      type="button"
                      className="account-member-remove"
                      onClick={() => onSwitchModal?.({ type: 'remove-user-account', target: user })}
                      aria-label={`Quitar ${user.name} de ${detailAccount.name}`}
                      title="Quitar de cuenta"
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                className={effectiveDetailAccountFilter === 'all' ? 'account-balance-row total active' : 'account-balance-row total'}
                onClick={() => setDetailAccountFilter('all')}
              >
                <span className="account-avatar">
                  <Users size={17} />
                </span>
                <span className="account-balance-copy">
                  <strong>Total cuenta</strong>
                  <small>{detailAccount.name}</small>
                </span>
                <strong className="account-balance-amount">{formatMoney(detailBalance?.balance ?? 0)}</strong>
              </button>
            </section>

            <div className="account-tabs" role="tablist" aria-label="Detalle de cuenta">
              <button
                type="button"
                className={detailAccountTab === 'history' ? 'active' : ''}
                onClick={() => setDetailAccountTab('history')}
              >
                Historial <span>{detailConsumptions.length}</span>
              </button>
              <button
                type="button"
                className={detailAccountTab === 'payments' ? 'active' : ''}
                onClick={() => setDetailAccountTab('payments')}
              >
                Cobros <span>{detailPayments.length}</span>
              </button>
            </div>

            {detailAccountTab === 'history' ? (
              <div className="account-timeline admin-account-history">
                {groupedDetailConsumptions.map((group) => (
                  <section className="account-day-group" key={group.key}>
                    <div className="account-day-heading">
                      <span>{group.label}</span>
                      <small>{countLabel(group.entries.length, 'consumo', 'consumos')}</small>
                    </div>

                    <div className="account-day-list">
                      {group.entries.map((consumption) => {
                        const user = data.users.find((entry) => entry.id === consumption.userId);
                        const consumptionItems = data.items.filter((item) => item.consumptionId === consumption.id);
                        const userName = user?.name ?? 'Usuario';
                        return (
                          <article className={consumption.status === 'voided' ? 'history-card voided' : 'history-card'} key={consumption.id}>
                            <div className="history-card-header">
                              <div className="history-person">
                                <span className="account-avatar">{initials(userName)}</span>
                                <div>
                                  <strong>{userName}</strong>
                                  <span>{formatMovementTime(consumption.createdAt)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="history-cart">
                              {consumptionItems.map((item) => {
                                const product = data.products.find((entry) => entry.id === item.productId);
                                const imageUrl = product?.imageUrl && !bulkFailedImages[item.productId] ? product.imageUrl : undefined;
                                return (
                                  <div className="history-cart-row" key={item.id}>
                                    <span className="history-item-thumbnail">
                                      {imageUrl ? (
                                        <img
                                          src={imageUrl}
                                          alt=""
                                          onError={() => setBulkFailedImages((current) => ({ ...current, [item.productId]: true }))}
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
                              <strong>{formatMoney(consumption.total)}</strong>
                            </div>
                            {consumption.status === 'voided' ? <small className="danger-text">Anulado</small> : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {detailConsumptions.length === 0 ? <p className="account-empty-state">Sin consumos para este filtro.</p> : null}
              </div>
            ) : null}

            {detailAccountTab === 'payments' ? (
              <div className="account-timeline admin-account-history">
                {groupedDetailPayments.map((group) => (
                  <section className="account-day-group" key={group.key}>
                    <div className="account-day-heading">
                      <span>{group.label}</span>
                      <small>{countLabel(group.entries.length, 'pago', 'pagos')}</small>
                    </div>

                    <div className="account-day-list">
                      {group.entries.map((payment) => {
                        const paymentUser = payment.userId ? data.users.find((entry) => entry.id === payment.userId) : null;
                        const payerUser = payment.paidByUserId ? data.users.find((entry) => entry.id === payment.paidByUserId) : null;
                        return (
                          <article className="payment-card" key={payment.id}>
                            <span className="payment-icon">
                              <CreditCard size={18} />
                            </span>

                            <div className="payment-card-copy">
                              <strong>Cobro recibido</strong>
                              <span>
                                {formatMovementTime(payment.createdAt)} -{' '}
                                {payment.targetType === 'user' && paymentUser
                                  ? paymentUser.name
                                  : 'Cuenta completa'}
                              </span>
                              {payerUser ? <small>Pagó {payerUser.name}</small> : null}
                              {payment.note ? <small>{payment.note}</small> : null}
                            </div>

                            <strong className="payment-amount">+ {formatMoney(payment.amount)}</strong>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {detailPayments.length === 0 ? <p className="account-empty-state">No hay pagos para este filtro.</p> : null}
              </div>
            ) : null}

          </>
        ) : modal.type === 'history' ? (
          <div className="admin-history-modal-body">
            <div className="table-list">
              {data.consumptions.map((consumption) => {
                const account = data.accounts.find((entry) => entry.id === consumption.accountId);
                const user = data.users.find((entry) => entry.id === consumption.userId);
                const consumptionItems = data.items.filter((item) => item.consumptionId === consumption.id);
                return (
                  <div className="history-row" key={consumption.id}>
                    <div>
                      <strong>{formatMoney(consumption.total)}</strong>
                      <p>
                        {account?.name} / {user?.name} / {new Date(consumption.createdAt).toLocaleString('es-CO')}
                      </p>
                      <small>
                        {consumptionItems.map((item) => `${item.productName} x${item.quantity}`).join(', ')}
                      </small>
                    </div>
                    <span className={consumption.status === 'voided' ? 'danger-text' : 'status-pill ok'}>
                      {consumption.status}
                    </span>
                    {consumption.status === 'confirmed' ? (
                      <button
                        type="button"
                        className="ghost small danger"
                        onClick={() => onSwitchModal?.({ type: 'void-consumption', target: consumption })}
                      >
                        Anular
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : modal.type === 'inventory-history' ? (
          <div className="admin-history-modal-body">
            <div className="table-list">
              {inventoryHistory.map((movement) => {
                const product = data.products.find((entry) => entry.id === movement.productId);
                const reversed = reversedInventoryMovementIds.has(movement.id);
                const isReversal = Boolean(movement.reversedMovementId);
                return (
                  <div className="history-row" key={movement.id}>
                    <div>
                      <strong>{product?.name ?? 'Producto'}</strong>
                      <p>
                        {movement.movementType} · {movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta} unidades
                        {movement.unitCost !== undefined ? ` · ${formatMoney(movement.unitCost)} c/u` : ''}
                      </p>
                      <small>{new Date(movement.createdAt).toLocaleString('es-CO')} · {movement.note ?? 'Sin nota'}</small>
                    </div>
                    <span className={reversed || isReversal ? 'status-pill muted' : 'status-pill ok'}>
                      {isReversal ? 'Reverso' : reversed ? 'Reversado' : 'Vigente'}
                    </span>
                    {!reversed && !isReversal && (movement.movementType === 'purchase' || movement.movementType === 'adjustment') ? (
                      <button
                        type="button"
                        className="ghost small danger"
                        onClick={() => onSwitchModal?.({ type: 'reverse-inventory', target: movement })}
                      >
                        Reversar
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {inventoryHistory.length === 0 ? (
                <p className="admin-empty-state">No hay movimientos de inventario.</p>
              ) : null}
            </div>
          </div>
        ) : (
          <form className="admin-modal-form form-grid" onSubmit={handleSubmit}>
            {modal.type === 'change-pin' && (
              <>
                <label htmlFor="admin-current-pin">PIN actual</label>
                <input
                  id="admin-current-pin"
                  name="currentPin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  minLength={4}
                  maxLength={8}
                  required
                  autoFocus
                />
                <label htmlFor="admin-new-pin">Nuevo PIN</label>
                <input
                  id="admin-new-pin"
                  name="newPin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  minLength={4}
                  maxLength={8}
                  required
                />
                <label htmlFor="admin-confirm-pin">Confirmar nuevo PIN</label>
                <input
                  id="admin-confirm-pin"
                  name="confirmPin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  minLength={4}
                  maxLength={8}
                  required
                />
                <p className="muted">Usa un PIN distinto al valor temporal del seed y no lo compartas.</p>
              </>
            )}
            {(modal.type === 'create-product' || modal.type === 'edit-product') && (
              <div className="product-photo-picker">
                <span className="product-photo-preview">
                  {productImageDraft ? (
                    <img src={productImageDraft} alt="" />
                  ) : (
                    <span className="product-photo-placeholder">
                      <Package size={34} />
                      <small>Imagen del producto</small>
                    </span>
                  )}
                </span>
                <label className="product-photo-action">
                  <input type="file" accept="image/*" onChange={handleProductImageUpload} />
                  <span>{productImageDraft ? 'Cambiar imagen' : 'Subir imagen'}</span>
                </label>
                <input type="hidden" name="imageUrl" value={productImageDraft} />
              </div>
            )}

            {modal.type === 'create-account' && (
              <>
                <label>Nombre de la cuenta</label>
                <input name="name" placeholder="Nombre de familia o grupo" required autoFocus />
                <label>Agregar usuarios (opcional)</label>
                {unassignedUsers.length > 0 ? (
                  <div className="admin-choice-list">
                    {unassignedUsers.map((user) => (
                      <label className="admin-choice-card" key={user.id}>
                        <input type="checkbox" name="userIds" value={user.id} />
                        <span className="admin-choice-avatar" aria-hidden="true">
                          {initials(user.name)}
                        </span>
                        <span className="admin-choice-copy">
                          <strong>{user.name}</strong>
                          <small>Sin cuenta</small>
                        </span>
                        <span className="admin-choice-mark" aria-hidden="true">
                          <CircleCheck size={17} />
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="admin-empty-state compact">No hay usuarios sin cuenta para agregar.</p>
                )}
              </>
            )}

            {modal.type === 'create-user' && (
              <>
                <label>Nombre del usuario</label>
                <input name="name" placeholder="Nombre completo" required />
                <label>Usuario para iniciar sesión</label>
                <input name="username" placeholder="Ej. samuel" autoComplete="off" />
                <label>PIN de acceso</label>
                <input
                  name="pin"
                  type="password"
                  placeholder="Entre 4 y 8 dígitos"
                  inputMode="numeric"
                  pattern="[0-9]{4,8}"
                  minLength={4}
                  maxLength={8}
                  autoComplete="new-password"
                  required
                />
              </>
            )}

            {modal.type === 'create-user' && (
              <>
                <label>Asociar a cuenta (opcional)</label>
                <div className="admin-choice-list">
                  <label className="admin-choice-card">
                    <input type="radio" name="accountId" value="" defaultChecked />
                    <span className="admin-choice-avatar muted" aria-hidden="true">
                      <Users size={18} />
                    </span>
                    <span className="admin-choice-copy">
                      <strong>Sin cuenta</strong>
                      <small>Usuario independiente</small>
                    </span>
                    <span className="admin-choice-mark" aria-hidden="true">
                      <CircleCheck size={17} />
                    </span>
                  </label>
                  {activeAccounts.map((account) => (
                    <label className="admin-choice-card" key={account.id}>
                      <input type="radio" name="accountId" value={account.id} />
                      <span className="admin-choice-avatar" aria-hidden="true">
                        {initials(account.name)}
                      </span>
                      <span className="admin-choice-copy">
                        <strong>{account.name}</strong>
                        <small>Cuenta activa</small>
                      </span>
                      <span className="admin-choice-mark" aria-hidden="true">
                        <CircleCheck size={17} />
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {modal.type === 'assign-user' && (
              <>
                <input type="hidden" name="accountId" value={modal.target?.id ?? ''} />
                <label>Usuario sin cuenta</label>
                {unassignedUsers.length > 0 ? (
                  <div className="admin-choice-list">
                    {unassignedUsers.map((user, index) => (
                      <label className="admin-choice-card" key={user.id}>
                        <input type="radio" name="userId" value={user.id} defaultChecked={index === 0} required />
                        <span className="admin-choice-avatar" aria-hidden="true">
                          {initials(user.name)}
                        </span>
                        <span className="admin-choice-copy">
                          <strong>{user.name}</strong>
                          <small>Sin cuenta</small>
                        </span>
                        <span className="admin-choice-mark" aria-hidden="true">
                          <CircleCheck size={17} />
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="admin-empty-state compact">No hay usuarios sin cuenta para agregar.</p>
                )}
              </>
            )}

            {modal.type === 'payment' && (
              <>
                {paymentTargetType === 'account' && fixedPaymentTarget ? (
                  <input type="hidden" name="accountId" value={paymentAccount} />
                ) : null}
                {paymentTargetType === 'account' && !fixedPaymentTarget && (
                  <>
                    <label>Cuenta</label>
                    <select
                      name="accountId"
                      value={paymentAccount}
                      onChange={(e) => setPaymentAccount(e.target.value)}
                      required
                    >
                      {activeAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {paymentTargetType === 'user' && fixedPaymentTarget ? (
                  <input type="hidden" name="userId" value={paymentUserId || targetUserId} />
                ) : null}
                {paymentTargetType === 'user' && fixedPaymentTarget ? (
                  <input type="hidden" name="paidByUserId" value={paymentUserId || targetUserId} />
                ) : (
                  <div className="payment-payer-row">
                    <span className="payment-payer-label">Usuario que paga</span>
                    {paymentPayers.length > 0 ? (
                      <div className="payment-payer-carousel" key={`${paymentTargetType}-${paymentAccount}-${paymentUserId}`}>
                        {paymentPayers.map((u, index) => (
                          <label className="payment-payer-pill" key={u.id}>
                            <input
                              type="radio"
                              name="paidByUserId"
                              value={u.id}
                              defaultChecked={index === 0}
                              required
                            />
                            <span className="payment-payer-avatar" aria-hidden="true">{initials(u.name)}</span>
                            <span>{u.name}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <>
                        <input type="hidden" name="paidByUserId" value="" />
                        <p className="admin-empty-state compact">Sin usuarios activos para pagar.</p>
                      </>
                    )}
                  </div>
                )}
                {!fixedPaymentTarget ? (
                  <>
                    <label>Destinatario</label>
                    <select value={paymentTargetType} onChange={(e) => setPaymentTargetType(e.target.value)}>
                      <option value="account">Abonar a cuenta completa</option>
                      <option value="user">Abonar a usuario especifico</option>
                    </select>
                  </>
                ) : null}
                {paymentTargetType === 'user' && !fixedPaymentTarget && (
                  <>
                    <label>Usuario</label>
                    <select
                      name="userId"
                      value={paymentUserId || paymentUsers[0]?.id || ''}
                      onChange={(e) => setPaymentUserId(e.target.value)}
                      required
                    >
                      {paymentUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}{u.accountId ? '' : ' (sin cuenta)'}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {shouldShowPaymentCheckout ? (
                  <section className="payment-checkout-summary" aria-label="Detalle del cobro">
                    <div className="payment-checkout-heading">
                      <span>Detalle del cobro</span>
                      <strong>{formatMoney(fixedPaymentBalance)}</strong>
                    </div>
                    <div className="payment-checkout-list">
                      {paymentOpenConsumptions.map((consumption) => {
                        const consumptionItems = data.items.filter((item) => item.consumptionId === consumption.id);
                        const firstItem = consumptionItems[0];
                        const product = data.products.find((entry) => entry.id === firstItem?.productId);
                        const productId = firstItem?.productId ?? consumption.id;
                        const imageUrl = product?.imageUrl && !bulkFailedImages[productId] ? product.imageUrl : undefined;
                        return (
                          <div className="payment-checkout-row" key={consumption.id}>
                            <span className="payment-checkout-thumbnail">
                              {imageUrl ? (
                                <img
                                  src={imageUrl}
                                  alt=""
                                  onError={() => setBulkFailedImages((current) => ({ ...current, [productId]: true }))}
                                />
                              ) : (
                                <span className="payment-checkout-placeholder">
                                  <Package size={16} />
                                </span>
                              )}
                            </span>
                            <span className="payment-checkout-item-copy">
                              <strong>{consumptionItems.map((item) => item.productName).join(', ') || 'Compra'}</strong>
                              <small>{new Date(consumption.createdAt).toLocaleDateString('es-CO')}</small>
                            </span>
                            <span className="payment-checkout-qty">{consumptionItems.length} item{consumptionItems.length === 1 ? '' : 's'}</span>
                            <strong>{formatMoney(consumption.openAmount)}</strong>
                          </div>
                        );
                      })}
                      {paymentCarryoverBalance > 0 ? (
                        <div className="payment-checkout-row carryover">
                          <span className="payment-checkout-thumbnail">
                            <span className="payment-checkout-placeholder">
                              <ReceiptText size={16} />
                            </span>
                          </span>
                          <span className="payment-checkout-item-copy">
                            <strong>Saldo arrastrado</strong>
                            <small>Ajustes o saldos anteriores</small>
                          </span>
                          <span className="payment-checkout-qty">x1</span>
                          <strong>{formatMoney(paymentCarryoverBalance)}</strong>
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                <div className="payment-amount-panel">
                  <span>Se paga</span>
                  <label className="payment-amount-field">
                    <DollarSign size={22} />
                    <input
                      name="amount"
                      placeholder="0"
                      inputMode="numeric"
                      defaultValue={fixedPaymentAmount}
                      aria-label="Monto del cobro"
                      required
                    />
                  </label>
                </div>
              </>
            )}

            {modal.type === 'reverse-payment' && (
              <>
                <div className="payment-amount-panel">
                  <span>Pago original</span>
                  <strong>{formatMoney(Number(modal.target?.amount) || 0)}</strong>
                </div>
                <label htmlFor="reverse-payment-reason">Motivo del reverso</label>
                <textarea
                  id="reverse-payment-reason"
                  name="reason"
                  placeholder="Ej. pago registrado por error"
                  minLength={3}
                  required
                  autoFocus
                />
                <p className="muted">Se conservará el pago original y se crearán movimientos inversos auditables.</p>
              </>
            )}

            {modal.type === 'reverse-adjustment' && (
              <>
                <div className="payment-amount-panel">
                  <span>Ajuste original</span>
                  <strong>{formatMoney(Number(modal.target?.amount) || 0)}</strong>
                </div>
                <label htmlFor="reverse-adjustment-reason">Motivo del reverso</label>
                <textarea
                  id="reverse-adjustment-reason"
                  name="reason"
                  placeholder="Ej. ajuste registrado por error"
                  minLength={3}
                  required
                  autoFocus
                />
                <p className="muted">El ajuste original se conserva y se crea un movimiento inverso enlazado.</p>
              </>
            )}

            {modal.type === 'void-consumption' && (
              <>
                <p className="muted">
                  Se conservará el consumo y se crearán los movimientos inversos de inventario con sus capas FIFO originales.
                </p>
                <label htmlFor="void-consumption-reason">Motivo de la anulación</label>
                <textarea
                  id="void-consumption-reason"
                  name="reason"
                  placeholder="Ej. compra registrada por error"
                  required
                  autoFocus
                />
              </>
            )}

            {modal.type === 'reverse-inventory' && (
              <>
                <p className="muted">
                  Se conservará el movimiento original y se registrará su inverso sin recalcular el historial previo.
                </p>
                <label htmlFor="reverse-inventory-reason">Motivo del reverso</label>
                <textarea
                  id="reverse-inventory-reason"
                  name="reason"
                  placeholder="Ej. compra de inventario registrada por error"
                  minLength={3}
                  required
                  autoFocus
                />
              </>
            )}

            {modal.type === 'adjustment' && (
              <>
                <label>Alcance</label>
                <select value={adjScope} onChange={(e) => setAdjScope(e.target.value)}>
                  <option value="account">Ajuste global de cuenta</option>
                  <option value="user">Ajuste a usuario específico</option>
                </select>
                {adjScope === 'account' && (
                  <>
                    <label>Cuenta</label>
                    <select
                      name="accountId"
                      value={adjAccount}
                      onChange={(event) => setAdjAccount(event.target.value)}
                      required
                    >
                      {activeAccounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </select>
                  </>
                )}
                {adjScope === 'user' && (
                  <>
                    <label>Usuario</label>
                    <select
                      name="userId"
                      value={adjUserId}
                      onChange={(event) => setAdjUserId(event.target.value)}
                      required
                    >
                      {adjUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}{u.accountId ? ` · ${data.accounts.find((account) => account.id === u.accountId)?.name ?? 'Cuenta'}` : ' · Independiente'}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <input name="amount" placeholder="Monto (+ deuda / - crédito)" inputMode="numeric" required />
                <input name="note" placeholder="Motivo del ajuste" required />
              </>
            )}

            {modal.type === 'independize' && (
              <>
                <label>Usuario a independizar</label>
                <select name="userId" defaultValue={modal.target?.id ?? activeUsers[0]?.id} required>
                  {activeUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({activeAccounts.find((a) => a.id === u.accountId)?.name})
                    </option>
                  ))}
                </select>
                <input name="newAccountName" placeholder="Nombre de la nueva cuenta" required />
              </>
            )}

            {modal.type === 'merge' && (
              <>
                <label>Cuenta origen (se desactivará y transferirá saldo)</label>
                <select name="sourceAccountId" required>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <label>Cuenta destino (recibe los usuarios y saldo)</label>
                <select name="targetAccountId" required>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            {modal.type === 'create-product' && (
              <>
                <label>Nombre</label>
                <input name="name" placeholder="Nombre del producto" required autoFocus />
                <label>Categoría</label>
                <div className="product-category-pills">
                  {PRODUCT_CATEGORIES.map((category) => (
                    <label key={category}>
                      <input type="radio" name="category" value={category} defaultChecked={category === 'Otros'} />
                      {category}
                    </label>
                  ))}
                </div>
              </>
            )}

            {modal.type === 'purchase' && (
              <>
                <label>Producto comprado</label>
                <select name="productId" value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} required>
                  {data.products
                    .filter((p) => p.status === 'active')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <input name="quantity" placeholder="Cantidad de unidades" inputMode="numeric" required />
                <input name="unitCost" placeholder="Costo unitario de compra" inputMode="numeric" required />
                <input name="note" placeholder="Nota opcional" />
              </>
            )}

            {modal.type === 'stock-adjustment' && (
              <>
                <label>Producto a ajustar</label>
                <select name="productId" value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} required>
                  {data.products
                    .filter((p) => p.status === 'active')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <input name="quantityDelta" placeholder="Cantidad delta (+ aumento / - merma)" inputMode="numeric" required />
                <input name="note" placeholder="Motivo del ajuste" required />
              </>
            )}

            {modal.type === 'edit-account' && (
              <>
                <label>Nombre de cuenta</label>
                <input name="name" defaultValue={modal.target.name} required />
              </>
            )}

            {modal.type === 'edit-user' && (
              <>
                <label>Nombre</label>
                <input name="name" defaultValue={modal.target.name} required autoFocus />
                <label>Usuario para iniciar sesión</label>
                <input name="username" defaultValue={modal.target.username ?? ''} autoComplete="off" />
                <label>Nuevo PIN (opcional)</label>
                <input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  placeholder="Dejar vacío para conservarlo"
                  pattern="[0-9]{4,8}"
                  minLength={4}
                  maxLength={8}
                  autoComplete="new-password"
                />
              </>
            )}

            {modal.type === 'edit-product' && (
              <>
                <label>Nombre del producto</label>
                <input name="name" defaultValue={modal.target.name} required />
                <label>Categoría</label>
                <div className="product-category-pills">
                  {PRODUCT_CATEGORIES.map((category) => (
                    <label key={category}>
                      <input
                        type="radio"
                        name="category"
                        value={category}
                        defaultChecked={
                          PRODUCT_CATEGORIES.includes(modal.target.category) ? modal.target.category === category : category === 'Otros'
                        }
                      />
                      {category}
                    </label>
                  ))}
                </div>
                <div className="product-compact-fields">
                  <label>
                    Precio venta
                    <span className="money-input">
                      <span>$</span>
                      <input name="price" defaultValue={modal.target.price} inputMode="numeric" required />
                    </span>
                  </label>
                  <label>
                    Stock mínimo
                    <input name="stockMin" defaultValue={modal.target.stockMin} inputMode="numeric" required />
                  </label>
                </div>
              </>
            )}

            {modal.type === 'bulk-products' && (
              <div className="admin-bulk-modal-body">
                {bulkProducts.map((product) => {
                  const stock = productStock(data, product.id);
                  const canShowImage = Boolean(product.imageUrl) && !bulkFailedImages[product.id];
                  return (
                    <div className={`admin-bulk-checkout-row is-${bulkMode ?? 'default'}`} key={product.id}>
                      <span className="admin-bulk-checkout-thumb" aria-hidden="true">
                        {canShowImage ? (
                          <img
                            src={product.imageUrl}
                            alt=""
                            onError={() => setBulkFailedImages((current) => ({ ...current, [product.id]: true }))}
                          />
                        ) : (
                          <Package size={22} />
                        )}
                      </span>

                      <div className="admin-bulk-checkout-copy">
                        <strong title={product.name}>{product.name}</strong>
                        <span>
                          Stock {stock} · {formatMoney(product.price)}
                        </span>
                      </div>

                      {bulkMode === 'purchase' && (
                        <div className="admin-bulk-checkout-controls purchase">
                          <label>
                            Cantidad
                            <input name={`quantity-${product.id}`} inputMode="numeric" placeholder="0" />
                          </label>
                          <label>
                            Costo
                            <span className="money-input">
                              <span>$</span>
                              <input name={`unitCost-${product.id}`} inputMode="numeric" defaultValue={product.lastCost} />
                            </span>
                          </label>
                        </div>
                      )}

                      {bulkMode === 'inventory' && (
                        <div className="admin-bulk-checkout-controls inventory">
                          <label>
                            Conteo físico
                            <input name={`stockCount-${product.id}`} inputMode="numeric" placeholder={`${stock}`} />
                          </label>
                        </div>
                      )}

                      {bulkMode === 'prices' && (
                        <div className="admin-bulk-checkout-controls single">
                          <label>
                            Nuevo precio
                            <span className="money-input">
                              <span>$</span>
                              <input name={`price-${product.id}`} inputMode="numeric" defaultValue={product.price} required />
                            </span>
                          </label>
                        </div>
                      )}

                    </div>
                  );
                })}

                {bulkProducts.length === 0 ? (
                  <p className="admin-empty-state compact">No hay productos seleccionados.</p>
                ) : null}
              </div>
            )}

            {modal.type === 'toggle-product-status' && (
              <p className="admin-confirm-copy">
                {modal.target.status === 'active'
                  ? `El producto "${modal.target.name}" dejara de aparecer como disponible.`
                  : `El producto "${modal.target.name}" volvera a estar disponible.`}
              </p>
            )}

            {modal.type === 'toggle-account-status' && (
              <p className="admin-confirm-copy">
                {modal.target.status === 'active'
                  ? `La cuenta "${modal.target.name}" quedara inactiva para nuevas acciones.`
                  : `La cuenta "${modal.target.name}" volvera a estar activa.`}
              </p>
            )}

            {modal.type === 'toggle-user-status' && (
              <p className="admin-confirm-copy">
                {modal.target.status === 'active'
                  ? `El usuario "${modal.target.name}" quedara inactivo para nuevas acciones.`
                  : `El usuario "${modal.target.name}" volvera a estar activo.`}
              </p>
            )}

            {['toggle-product-status', 'toggle-account-status', 'toggle-user-status'].includes(modal.type) ? (
              <>
                <label htmlFor="status-change-reason">Motivo</label>
                <textarea
                  id="status-change-reason"
                  name="reason"
                  placeholder={modal.target.status === 'active' ? 'Motivo para archivar' : 'Motivo para restaurar'}
                  minLength={3}
                  required
                />
              </>
            ) : null}

            {modal.type === 'move-user' && (
              <>
                <label>Usuario</label>
                <select name="userId" required>
                  <option value="">Selecciona un usuario</option>
                  {data.users
                    .filter((entry) => entry.role === 'user' && entry.status === 'active')
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} · {data.accounts.find((account) => account.id === entry.accountId)?.name ?? 'Sin cuenta'}
                      </option>
                    ))}
                </select>
                <label>Cuenta destino</label>
                <select name="accountId">
                  <option value="">Dejar sin cuenta</option>
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                <p className="muted">El saldo permanece asociado al usuario y el cambio quedará auditado.</p>
              </>
            )}

            {modal.type === 'remove-user-account' && (
              <p className="admin-confirm-copy">
                {`"${modal.target.name}" quedara sin cuenta. Su saldo se mantiene con el usuario.`}
              </p>
            )}

            <div className="modal-actions">
              <button type="submit" className="primary" disabled={submitting}>
                {submitting
                  ? 'Guardando...'
                  : modal.type === 'toggle-product-status' ||
                modal.type === 'toggle-account-status' ||
                modal.type === 'toggle-user-status' ||
                modal.type === 'remove-user-account' ||
                modal.type === 'bulk-products'
                  ? 'Confirmar'
                  : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
