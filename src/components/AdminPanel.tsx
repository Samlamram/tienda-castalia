import type { ChangeEvent, FormEvent } from 'react';
import { useMemo, useState } from 'react';
import {
  Boxes,
  BrushCleaning,
  CreditCard,
  DollarSign,
  Download,
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
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import type { Account, AppSession, PersonUser, Product } from '../domain/types';
import { BrandLogo } from './BrandLogo';
import { calculateOpenItems, calculateUserBalances } from '../domain/ledger';
import type { useTiendaData } from '../hooks/useTiendaData';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { resetDemoData } from '../data/seed';
import { buildExportRows, exportToGoogleSheets } from '../services/export';
import * as adminApi from '../services/adminApi';
import { formatMoney, toNumber } from '../utils/money';
import { isSyncConfigured, syncNow } from '../services/sync';

type TiendaData = ReturnType<typeof useTiendaData>;
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

function LegacyAdminPanel({ data, onMessage, onLogout, online, adminSession }: AdminPanelProps) {
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
              adminSession
                ? async () => {
                    await adminApi.loadAdminSnapshot(adminSession);
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
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'export' })}>
                <Download size={16} /> Exportar a Sheets
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
                      <span>Costo: {formatMoney(product.lastCost)}</span>
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
        />
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   HeaderSyncWidget
   ═══════════════════════════════════════════════════════ */

export function AdminPanel({ data, onMessage, onLogout, online, adminSession }: AdminPanelProps) {
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
      const stock = productStock(data, product.id);
      const availableStock = Math.max(0, stock);
      return {
        units: summary.units + availableStock,
        value: summary.value + availableStock * product.price
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
        const users = data.users.filter((user) => user.accountId === account.id);
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

  const userBalances = useMemo(
    () =>
      calculateUserBalances({
        users: data.users,
        consumptions: data.consumptions,
        items: data.items,
        payments: data.payments,
        applications: data.applications,
        adjustments: data.adjustments
      }),
    [data]
  );

  const filteredUsers = useMemo(() => {
    const query = normalizeSearch(accountQuery);
    return data.users
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
      const users = data.users.filter((user) => user.accountId === account.id);
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
      .filter((user) => !user.accountId)
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
              adminSession
                ? async () => {
                    await adminApi.loadAdminSnapshot(adminSession);
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
                  <span>Inventario</span>
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
                          <strong title={product.name}>{product.name}</strong>
                          <small>{product.category}</small>
                        </span>
                      </div>

                      <div className="admin-inventory-stock" role="cell">
                        <span className="admin-inventory-stock-main">
                          <small>Stock</small>
                          <strong>{stock}</strong>
                        </span>
                        <span className={`admin-inventory-stock-meta inventory-${tone}`}>
                          {productStatusLabel(tone)}
                        </span>
                      </div>

                      <div className="admin-inventory-values" role="cell">
                        <span>
                          <small>Venta</small>
                          <strong>{formatMoney(product.price)}</strong>
                        </span>
                        <span>
                          <small>Inventario</small>
                          <strong>{formatMoney(subtotal)}</strong>
                        </span>
                      </div>

                      <div className="admin-inventory-actions" role="cell">
                        <button
                          type="button"
                          className="ghost icon admin-inventory-action"
                          onClick={() => setActiveModal({ type: 'edit-product', target: product })}
                          aria-label={`Modificar ${product.name}`}
                          title="Modificar"
                        >
                          <Edit size={17} />
                        </button>
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
                        <span>{formatMovementTime(payment.createdAt)}</span>
                        {payerUser ? <small>Pago {payerUser.name}</small> : null}
                      </div>
                      <strong className="payment-amount">+ {formatMoney(payment.amount)}</strong>
                    </article>
                  ))}
                  {chargeHistory.length === 0 ? (
                    <p className="admin-empty-state">No hay cobros registrados.</p>
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
    if (syncing || !online || !syncConfigured) return;
    setSyncing(true);
    try {
      if (onManualSync) {
        onMessage(await onManualSync());
        return;
      }
      const result = await syncNow();
      onMessage(`Sincronización: ${result.pushed} enviados, ${result.pulled} recibidos.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'No se pudo sincronizar.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="header-sync-widget">
      <span
        className={`sync-status-icon ${online ? 'online' : 'offline'}`}
        title={online ? 'Conectado a Internet' : 'Trabajando Offline (sin internet)'}
      >
        {online ? <Cloud size={18} /> : <CloudOff size={18} />}
      </span>

      <button
        type="button"
        className={`sync-action-btn ${pendingSync > 0 ? 'has-pending' : ''} ${syncing ? 'is-syncing' : ''}`}
        onClick={handleSync}
        disabled={!online || syncing || !syncConfigured}
        title={
          !syncConfigured
            ? 'Sincronización no configurada (falta Supabase)'
            : pendingSync > 0
              ? `${pendingSync} cambio(s) pendiente(s). Haz clic para sincronizar.`
              : 'Todo sincronizado. Haz clic para forzar sync.'
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
}

function AdminModalContainer({
  modal,
  data,
  onClose,
  onSwitchModal,
  onBulkComplete,
  onMessage,
  adminSession
}: AdminModalContainerProps) {
  useBodyScrollLock(true);

  const activeAccounts = data.accounts.filter((a) => a.status === 'active');
  const activeUsers = data.users.filter((u) => u.status === 'active');
  const unassignedUsers = activeUsers.filter((u) => !u.accountId);
  const modalTargetIsUser = Boolean(modal.target && typeof modal.target === 'object' && 'pinHash' in modal.target);
  const modalTargetIsAccount = Boolean(modal.target && typeof modal.target === 'object' && !modalTargetIsUser && 'name' in modal.target && 'status' in modal.target);
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
      ? data.users.filter((u) => u.accountId === paymentAccount && u.status === 'active')
      : activeUsers;
  const paymentPayers = paymentTargetType === 'account' ? paymentUsers : activeUsers;
  const fixedPaymentTarget = modal.type === 'payment' && (modalTargetIsAccount || modalTargetIsUser);
  const fixedPaymentBalance = (() => {
    if (modal.type !== 'payment') return 0;
    if (modalTargetIsAccount && typeof modal.target?.id === 'string') {
      return data.accountBalances.find((entry) => entry.accountId === modal.target.id)?.balance ?? 0;
    }
    if (modalTargetIsUser && typeof modal.target?.id === 'string') {
      return calculateUserBalances({
        users: [modal.target as PersonUser],
        consumptions: data.consumptions,
        items: data.items,
        payments: data.payments,
        applications: data.applications,
        adjustments: data.adjustments
      })[0]?.balance ?? 0;
    }
    return 0;
  })();
  const fixedPaymentAmount = fixedPaymentBalance > 0 ? String(fixedPaymentBalance) : '';
  const paymentOpenItems =
    modal.type === 'payment' && fixedPaymentTarget && typeof modal.target?.id === 'string'
      ? calculateOpenItems({
          accountId: modalTargetIsAccount ? modal.target.id : undefined,
          userId: modalTargetIsUser ? modal.target.id : undefined,
          consumptions: data.consumptions,
          items: data.items,
          applications: data.applications
        })
      : [];
  const paymentOpenItemsTotal = paymentOpenItems.reduce((sum, item) => sum + item.openAmount, 0);
  const paymentCarryoverBalance = Math.max(0, Math.round(fixedPaymentBalance - paymentOpenItemsTotal));
  const shouldShowPaymentCheckout =
    modal.type === 'payment' &&
    fixedPaymentTarget &&
    fixedPaymentBalance > 0 &&
    (paymentOpenItems.length > 0 || paymentCarryoverBalance > 0);

  // Ajuste manual
  const [adjAccount, setAdjAccount] = useState(targetAccountId);
  const [adjScope, setAdjScope] = useState(
    modal.type === 'adjustment' && typeof modal.target?.accountId === 'string' ? 'user' : 'account'
  );
  const adjUsers = data.users.filter((u) => u.accountId === adjAccount && u.status === 'active');
  const [selectedProductId, setSelectedProductId] = useState(targetProductId);
  const [productImageDraft, setProductImageDraft] = useState(
    modal.type === 'edit-product' ? (modal.target?.imageUrl ?? '') : ''
  );
  const [bulkFailedImages, setBulkFailedImages] = useState<Record<string, boolean>>({});
  const [detailAccountTab, setDetailAccountTab] = useState<AdminAccountDetailTab>('history');
  const [detailAccountFilter, setDetailAccountFilter] = useState('all');
  const bulkMode = modal.type === 'bulk-products' ? (modal.target?.mode as BulkProductAction | undefined) : undefined;
  const bulkProductIds = modal.type === 'bulk-products' && Array.isArray(modal.target?.productIds)
    ? (modal.target.productIds as string[])
    : [];
  const bulkProducts = bulkProductIds
    .map((id) => data.products.find((product) => product.id === id))
    .filter(Boolean) as Product[];

  // Export
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = useMemo(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  }, []);
  const sheetSetting = data.settings.find((s) => s.key === 'sheet_id')?.value ?? '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      switch (modal.type) {
        case 'create-account':
          const createdAccount = await adminApi.createAccount({ name: String(form.get('name') ?? '') }, adminSession);
          const createdAccountId = createdAccount?.id;
          if (createdAccountId) {
            for (const userId of form.getAll('userIds')) {
              await adminApi.assignUserToAccount(String(userId), createdAccountId, adminSession);
            }
          }
          onMessage('Cuenta creada.');
          break;

        case 'create-user':
          const newUserAccountId = String(form.get('accountId') ?? '').trim();
          await adminApi.createUser({
            accountId: newUserAccountId || undefined,
            name: String(form.get('name') ?? ''),
            pin: String(form.get('pin') ?? '1234')
          }, adminSession);
          onMessage('Usuario creado.');
          break;

        case 'assign-user':
          await adminApi.assignUserToAccount(
            String(form.get('userId') ?? ''),
            String(form.get('accountId') ?? modal.target?.id ?? ''),
            adminSession
          );
          onMessage('Usuario agregado a la cuenta.');
          break;

        case 'remove-user-account':
          await adminApi.removeUserFromAccount(String(modal.target.id), adminSession);
          onMessage('Usuario removido de la cuenta.');
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
          }, adminSession);
          onMessage('Cobro registrado.');
          break;

        case 'adjustment':
          await adminApi.createBalanceAdjustment({
            accountId: String(form.get('accountId')),
            scope: adjScope === 'user' ? 'user' : 'account',
            userId: adjScope === 'user' ? String(form.get('userId')) : undefined,
            amount: Number(form.get('amount')),
            note: String(form.get('note') ?? '')
          }, adminSession);
          onMessage('Ajuste registrado.');
          break;

        case 'independize':
          await adminApi.independizeUser(
            String(form.get('userId')),
            String(form.get('newAccountName') ?? ''),
            adminSession
          );
          onMessage('Usuario independizado.');
          break;

        case 'merge':
          await adminApi.mergeAccounts(
            String(form.get('sourceAccountId')),
            String(form.get('targetAccountId')),
            adminSession
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
          }, adminSession);
          onMessage('Producto creado.');
          break;

        case 'purchase':
          await adminApi.createPurchase({
            productId: String(form.get('productId')),
            quantity: toNumber(form.get('quantity')),
            unitCost: toNumber(form.get('unitCost')),
            note: String(form.get('note') ?? '')
          }, adminSession);
          onMessage('Compra registrada.');
          break;

        case 'stock-adjustment':
          await adminApi.adjustInventory({
            productId: String(form.get('productId')),
            quantityDelta: Number(form.get('quantityDelta')),
            note: String(form.get('note') ?? '')
          }, adminSession);
          onMessage('Stock ajustado.');
          break;

        case 'export':
          const sheetId = String(form.get('sheetId') ?? '');
          const dateFrom = `${String(form.get('dateFrom'))}T00:00:00.000Z`;
          const dateTo = `${String(form.get('dateTo'))}T23:59:59.999Z`;
          const result = await exportToGoogleSheets({ sheetId, dateFrom, dateTo });
          onMessage(result.message);
          break;

        case 'edit-account':
          await adminApi.updateAccount({ ...modal.target, name: String(form.get('name') ?? '') }, adminSession);
          onMessage('Cuenta actualizada.');
          break;

        case 'edit-user':
          const newPin = String(form.get('pin') ?? '').trim();
          await adminApi.updateUser(
            {
              ...modal.target,
              newPin: newPin || undefined
            },
            adminSession
          );
          onMessage('PIN actualizado.');
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
            adminSession
          );
          onMessage('Producto actualizado.');
          break;

        case 'toggle-product-status':
          await adminApi.updateProduct(
            {
              ...modal.target,
              status: modal.target.status === 'active' ? 'inactive' : 'active'
            },
            adminSession
          );
          onMessage(modal.target.status === 'active' ? 'Producto desactivado.' : 'Producto activado.');
          break;

        case 'toggle-user-status':
          await adminApi.updateUser(
            {
              ...modal.target,
              status: modal.target.status === 'active' ? 'inactive' : 'active'
            },
            adminSession
          );
          onMessage(modal.target.status === 'active' ? 'Usuario desactivado.' : 'Usuario activado.');
          break;

        case 'toggle-account-status':
          await adminApi.updateAccount(
            {
              ...modal.target,
              status: modal.target.status === 'active' ? 'inactive' : 'active'
            },
            adminSession
          );
          onMessage(modal.target.status === 'active' ? 'Cuenta desactivada.' : 'Cuenta activada.');
          break;

        case 'bulk-products':
          if (bulkMode === 'purchase') {
            let count = 0;
            for (const product of bulkProducts) {
              const quantity = toNumber(form.get(`quantity-${product.id}`));
              if (quantity <= 0) continue;
              await adminApi.createPurchase(
                {
                  productId: product.id,
                  quantity,
                  unitCost: toNumber(form.get(`unitCost-${product.id}`)),
                  note: String(form.get(`note-${product.id}`) ?? '')
                },
                adminSession
              );
              count += 1;
            }
            onMessage(`${count} compra${count === 1 ? '' : 's'} registrada${count === 1 ? '' : 's'}.`);
          }

          if (bulkMode === 'inventory') {
            let count = 0;
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
              await adminApi.adjustInventory(
                {
                  productId: product.id,
                  quantityDelta,
                  note: String(
                    form.get(`note-${product.id}`) ??
                      `Cuadre de inventario: conteo ${countedStock}, sistema ${currentStock}`
                  )
                },
                adminSession
              );
              count += 1;
            }
            onMessage(`${count} ajuste${count === 1 ? '' : 's'} de inventario aplicado${count === 1 ? '' : 's'}.`);
          }

          if (bulkMode === 'prices') {
            let count = 0;
            for (const product of bulkProducts) {
              await adminApi.updateProduct(
                {
                  ...product,
                  price: toNumber(form.get(`price-${product.id}`))
                },
                adminSession
              );
              count += 1;
            }
            onMessage(`${count} precio${count === 1 ? '' : 's'} actualizado${count === 1 ? '' : 's'}.`);
          }

          onBulkComplete?.();
          break;
      }
      onClose();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Error en la operación.');
    }
  }

  async function handlePreview() {
    const rows = await buildExportRows(`${firstDay}T00:00:00.000Z`, `${today}T23:59:59.999Z`);
    onMessage(`Export incluye ${Object.keys(rows).length} pestañas: ${Object.keys(rows).join(', ')}.`);
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
  const detailUsers = detailAccount ? data.users.filter((user) => user.accountId === detailAccount.id) : [];
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

  return (
    <div className="modal-backdrop">
      <div
        className={
          modal.type === 'account-detail'
            ? 'modal account-modal admin-account-detail-modal'
            : `modal admin-action-modal ${modal.type === 'bulk-products' ? 'wide admin-bulk-modal' : ''} ${modal.type === 'payment' ? 'admin-payment-modal' : ''}`
        }
      >
        {modal.type !== 'account-detail' ? (
          <div className="admin-modal-title-row">
            <h2>
              {modal.type === 'create-account' && 'Crear Nueva Cuenta'}
              {modal.type === 'create-user' && 'Crear Nuevo Usuario'}
              {modal.type === 'payment' && 'Registrar Cobro'}
              {modal.type === 'assign-user' && 'Agregar Usuario a Cuenta'}
              {modal.type === 'adjustment' && 'Realizar Ajuste Manual'}
              {modal.type === 'independize' && 'Independizar Usuario'}
              {modal.type === 'merge' && 'Unir Cuentas'}
              {modal.type === 'create-product' && 'Agregar Producto'}
              {modal.type === 'purchase' && 'Registrar Compra / Inventario'}
              {modal.type === 'stock-adjustment' && 'Ajuste de Stock'}
              {modal.type === 'export' && 'Exportar a Google Sheets'}
              {modal.type === 'edit-account' && 'Editar Cuenta'}
              {modal.type === 'edit-user' && 'Cambiar PIN'}
              {modal.type === 'edit-product' && 'Editar Producto'}
              {modal.type === 'history' && 'Historial de Consumos'}
              {modal.type === 'toggle-account-status' &&
                (modal.target.status === 'active' ? 'Desactivar Cuenta' : 'Activar Cuenta')}
              {modal.type === 'toggle-product-status' &&
                (modal.target.status === 'active' ? 'Desactivar Producto' : 'Activar Producto')}
              {modal.type === 'toggle-user-status' &&
                (modal.target.status === 'active' ? 'Desactivar Usuario' : 'Activar Usuario')}
              {modal.type === 'remove-user-account' && 'Quitar Usuario de Cuenta'}
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
              {data.consumptions.slice(0, 60).map((consumption) => {
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
                        onClick={async () => {
                          const reason = window.prompt('Motivo de anulación', 'Error de registro');
                          if (!reason) return;
                          await adminApi.voidConsumption(consumption.id, reason, adminSession);
                          onMessage('Consumo anulado.');
                          onClose();
                        }}
                      >
                        Anular
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <form className="admin-modal-form form-grid" onSubmit={handleSubmit}>
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
                <label>PIN de acceso</label>
                <input name="pin" placeholder="PIN de 4 dígitos" inputMode="numeric" defaultValue="1234" required />
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
                      {paymentOpenItems.map((item) => {
                        const product = data.products.find((entry) => entry.id === item.productId);
                        const imageUrl = product?.imageUrl && !bulkFailedImages[item.productId] ? product.imageUrl : undefined;
                        return (
                          <div className="payment-checkout-row" key={item.id}>
                            <span className="payment-checkout-thumbnail">
                              {imageUrl ? (
                                <img
                                  src={imageUrl}
                                  alt=""
                                  onError={() => setBulkFailedImages((current) => ({ ...current, [item.productId]: true }))}
                                />
                              ) : (
                                <span className="payment-checkout-placeholder">
                                  <Package size={16} />
                                </span>
                              )}
                            </span>
                            <span className="payment-checkout-item-copy">
                              <strong>{item.productName}</strong>
                              <small>{formatMoney(item.unitPrice)} c/u</small>
                            </span>
                            <span className="payment-checkout-qty">x{item.quantity}</span>
                            <strong>{formatMoney(item.openAmount)}</strong>
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

            {modal.type === 'adjustment' && (
              <>
                <label>Cuenta de origen</label>
                <select
                  name="accountId"
                  value={adjAccount}
                  onChange={(e) => setAdjAccount(e.target.value)}
                  required
                >
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <label>Alcance</label>
                <select value={adjScope} onChange={(e) => setAdjScope(e.target.value)}>
                  <option value="account">Ajuste global de cuenta</option>
                  <option value="user">Ajuste a usuario específico</option>
                </select>
                {adjScope === 'user' && (
                  <>
                    <label>Usuario</label>
                    <select name="userId" required>
                      {adjUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
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

            {modal.type === 'export' && (
              <>
                <label>Google Sheet ID</label>
                <input name="sheetId" placeholder="ID de la hoja" defaultValue={sheetSetting} required />
                <label>Desde</label>
                <input name="dateFrom" type="date" defaultValue={firstDay} required />
                <label>Hasta</label>
                <input name="dateTo" type="date" defaultValue={today} required />
                <button type="button" className="ghost" onClick={handlePreview}>
                  Previsualizar
                </button>
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
                <label>Nuevo PIN de {modal.target.name}</label>
                <input name="pin" type="password" inputMode="numeric" placeholder="Nuevo PIN" required autoFocus />
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

            {modal.type === 'remove-user-account' && (
              <p className="admin-confirm-copy">
                {`"${modal.target.name}" quedara sin cuenta. Su saldo se mantiene con el usuario.`}
              </p>
            )}

            <div className="modal-actions">
              <button type="submit" className="primary">
                {modal.type === 'toggle-product-status' ||
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
