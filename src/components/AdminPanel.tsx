import type { ChangeEvent, FormEvent } from 'react';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  BrushCleaning,
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
import type { useTiendaData } from '../hooks/useTiendaData';
import { resetDemoData } from '../data/seed';
import { buildExportRows, exportToGoogleSheets } from '../services/export';
import * as adminApi from '../services/adminApi';
import { formatMoney, toNumber } from '../utils/money';
import { isSyncConfigured, syncNow } from '../services/sync';

type TiendaData = ReturnType<typeof useTiendaData>;
type AdminSection = null | 'catalogo' | 'cuentas' | 'productos';
type ProductFilter = 'active' | 'inactive' | 'low' | 'all';
type AccountFilter = 'debt' | 'clear' | 'inactive' | 'all';
type AccountPanelTab = 'accounts' | 'users';
type UserFilter = 'active' | 'debt' | 'inactive' | 'all';
type BulkProductAction = 'purchase' | 'inventory' | 'prices';
type ModalState = null | { type: string; target?: any };
const PRODUCT_CATEGORIES = ['Bebidas', 'Comida', 'Dulces', 'Otros'] as const;

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
            <Store size={24} />
          </div>
          <div className="kiosk-brand-copy">
            <strong>Tienda Castalia</strong>
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
                <ReceiptText size={16} /> Registrar Pago
              </button>
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'adjustment' })}>
                Ajuste Manual
              </button>
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'independize' })}>
                <Split size={16} /> Independizar
              </button>
              <button type="button" className="secondary small" onClick={() => setActiveModal({ type: 'merge' })}>
                Unir Cuentas
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
  const [productFilter, setProductFilter] = useState<ProductFilter>('active');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('debt');
  const [accountView, setAccountView] = useState<AccountPanelTab>('accounts');
  const [userFilter, setUserFilter] = useState<UserFilter>('active');
  const [productQuery, setProductQuery] = useState('');
  const [accountQuery, setAccountQuery] = useState('');
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  const activeAccountsCount = data.accounts.filter((a) => a.status === 'active').length;
  const activeProductsCount = data.products.filter((p) => p.status === 'active').length;
  const lowStockProducts = data.products.filter((product) => {
    const stock = productStock(data, product.id);
    return product.status === 'active' && stock <= product.stockMin;
  });
  const debtAccounts = data.accountBalances.filter((balance) => {
    const account = data.accounts.find((entry) => entry.id === balance.accountId);
    return account?.status === 'active' && balance.balance > 0;
  });
  const totalDebt = debtAccounts.reduce((sum, balance) => sum + balance.balance, 0);
  const inventoryValue = data.products.reduce((sum, product) => {
    const stock = productStock(data, product.id);
    return stock > 0 ? sum + stock * product.lastCost : sum;
  }, 0);
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
        const priority = productPriority(a.product, a.stock) - productPriority(b.product, b.stock);
        if (priority !== 0) return priority;
        if (a.stock !== b.stock) return a.stock - b.stock;
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

  const filteredUsers = useMemo(() => {
    const query = normalizeSearch(accountQuery);
    return data.users
      .map((user) => {
        const account = data.accounts.find((entry) => entry.id === user.accountId);
        const accountBalance = data.accountBalances.find((entry) => entry.accountId === user.accountId);
        const balance = accountBalance?.users.find((entry) => entry.userId === user.id)?.balance ?? 0;
        return { user, account, balance };
      })
      .filter(({ user, account, balance }) => {
        const matchesQuery =
          !query ||
          normalizeSearch(user.name).includes(query) ||
          normalizeSearch(account?.name ?? '').includes(query);
        const matchesFilter =
          userFilter === 'all' ||
          (userFilter === 'active' && user.status === 'active') ||
          (userFilter === 'inactive' && user.status === 'inactive') ||
          (userFilter === 'debt' && user.status === 'active' && balance > 0);
        return matchesQuery && matchesFilter;
      })
      .sort((a, b) => {
        if (a.user.status !== b.user.status) return a.user.status === 'active' ? -1 : 1;
        if (b.balance !== a.balance) return b.balance - a.balance;
        return a.user.name.localeCompare(b.user.name);
      });
  }, [accountQuery, data, userFilter]);

  return (
    <section className={`admin-session ${activeSection === 'catalogo' && selectedProductIds.length > 0 ? 'has-bulk-bar' : ''}`}>
      <header className="kiosk-header">
        <div className="kiosk-brand-block">
          <div className="kiosk-logo" aria-hidden="true">
            <Store size={24} />
          </div>
          <div className="kiosk-brand-copy">
            <strong>Tienda Castalia</strong>
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
          <div className="admin-summary-card debt">
            <ReceiptText size={20} />
            <span>Deuda total</span>
            <strong>{formatMoney(totalDebt)}</strong>
          </div>
          <div className="admin-summary-card inventory">
            <Boxes size={20} />
            <span>Valor inventario</span>
            <strong>{formatMoney(inventoryValue)}</strong>
          </div>
          <div className="admin-summary-card warning">
            <AlertTriangle size={20} />
            <span>Bajo stock</span>
            <strong>{lowStockProducts.length}</strong>
          </div>
          <div className="admin-summary-card accounts">
            <Users size={20} />
            <span>Cuentas con deuda</span>
            <strong>{debtAccounts.length}</strong>
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

              <div className="product-grid catalog-grid admin-catalog-grid">
                <button
                  type="button"
                  className="product-tile admin-add-product-tile"
                  onClick={() => setActiveModal({ type: 'create-product' })}
                >
                  <div className="product-media">
                    <span className="product-image-slot admin-add-product-media" aria-hidden="true">
                      <Plus size={34} />
                    </span>
                  </div>
                  <div className="product-tile-action-bar">
                    <span className="tile-add-btn">
                      <Plus size={16} />
                      Crear
                    </span>
                  </div>
                </button>

                {filteredProducts.map(({ product, stock }) => {
                  const tone = productTone(product, stock);
                  const hasImage = product.imageUrl && !failedImages[product.id];
                  const isSelected = selectedProductIds.includes(product.id);
                  return (
                    <article
                      key={product.id}
                      className={`product-tile admin-product-tile stock-${tone} ${isSelected ? 'selected' : ''}`}
                    >
                      <div
                        className="product-media admin-product-media"
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleProductSelection(product.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleProductSelection(product.id);
                          }
                        }}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? 'Quitar seleccion' : 'Seleccionar'} ${product.name}`}
                      >
                        <span className="product-image-slot" aria-hidden="true">
                          {hasImage ? (
                            <img
                              src={product.imageUrl}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={() => setFailedImages((prev) => ({ ...prev, [product.id]: true }))}
                            />
                          ) : (
                            <div className="product-placeholder-gradient">
                              <Package size={32} />
                              <span>{product.category}</span>
                            </div>
                          )}
                        </span>
                        <span className={`admin-stock-badge ${tone}`}>
                          Stock {stock}
                        </span>
                        {isSelected ? (
                          <span className="admin-selected-badge" aria-hidden="true">
                            <CircleCheck size={18} />
                          </span>
                        ) : null}
                      </div>

                      <div className="product-details admin-product-details">
                        <strong className="product-name" title={product.name}>
                          {product.name}
                        </strong>
                        <span className="product-price">{formatMoney(product.price)}</span>
                      </div>

                      <div className="admin-tile-action-grid">
                        <button
                          type="button"
                          className="tile-add-btn admin-tile-primary"
                          onClick={() => setActiveModal({ type: 'edit-product', target: product })}
                        >
                          <Edit size={15} /> Modificar
                        </button>
                        <button
                          type="button"
                          className={`tile-action-btn admin-tile-status ${product.status === 'active' ? 'is-on' : 'is-off'}`}
                          onClick={() => setActiveModal({ type: 'toggle-product-status', target: product })}
                          aria-label={product.status === 'active' ? `Desactivar ${product.name}` : `Activar ${product.name}`}
                          title={product.status === 'active' ? 'Activo' : 'Inactivo'}
                        >
                          {product.status === 'active' ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
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
                      ['debt', 'Con deuda'],
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

              <div className="admin-smart-list admin-accounts-grid">
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
                      <span>
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
                                  <span className={`status-pill ${account.status === 'active' ? 'ok' : 'muted'}`}>
                                    {account.status === 'active' ? 'Activa' : 'Inactiva'}
                                  </span>
                                </div>
                                <div className="admin-item-metrics">
                                  <span>{users.length} usuario{users.length === 1 ? '' : 's'}</span>
                                  <span>Ultimo mov. {latestAccountActivity(data, account.id)}</span>
                                </div>
                              </div>
                            </div>

                            <div className={`admin-balance-focus ${accountBalance > 0 ? 'debt' : 'clear'}`}>
                              <span>Saldo</span>
                              <strong>{formatMoney(accountBalance)}</strong>
                            </div>

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
                                    onClick={() => setActiveModal({ type: 'create-user', target: { accountId: account.id } })}
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
                                  onClick={() => setActiveModal({ type: 'create-user', target: { accountId: account.id } })}
                                >
                                  <Plus size={15} /> Usuario
                                </button>
                              )}
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
                                onClick={() => setActiveModal({ type: 'payment', target: account })}
                              >
                                <ReceiptText size={15} /> Pago
                              </button>
                              <button
                                type="button"
                                className="ghost small"
                                onClick={() => setActiveModal({ type: 'edit-account', target: account })}
                                title="Editar cuenta"
                              >
                                <Edit size={15} /> Editar
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
                      className="admin-account-item admin-user-item admin-account-create-card"
                      onClick={() => setActiveModal({ type: 'create-user' })}
                    >
                      <span className="admin-create-card-icon" aria-hidden="true">
                        <Plus size={28} />
                      </span>
                      <span>
                        <strong>Anadir usuario</strong>
                        <small>Vincular a una cuenta existente</small>
                      </span>
                    </button>

                    {filteredUsers.map(({ user, account, balance }) => (
                      <article
                        key={user.id}
                        className={`admin-account-item admin-user-item ${user.status === 'inactive' ? 'account-inactive' : balance > 0 ? 'account-debt' : 'account-clear'}`}
                      >
                        <div className="admin-user-panel-grid">
                          <span className="admin-user-avatar" aria-hidden="true">
                            {initials(user.name)}
                          </span>
                          <div className="admin-item-main">
                            <div className="admin-item-title-row">
                              <strong>{user.name}</strong>
                              <span className={`status-pill ${user.status === 'active' ? 'ok' : 'muted'}`}>
                                {user.status === 'active' ? 'Activo' : 'Inactivo'}
                              </span>
                            </div>
                            <div className="admin-item-metrics">
                              <span>Cuenta <strong>{account?.name ?? 'Sin cuenta'}</strong></span>
                              <span>Ultimo mov. {latestUserActivity(data, user.id)}</span>
                            </div>
                          </div>
                          <div className={`admin-balance-focus ${balance > 0 ? 'debt' : 'clear'}`}>
                            <span>Saldo</span>
                            <strong>{formatMoney(balance)}</strong>
                          </div>
                          <div className="admin-row-actions admin-panel-actions">
                            <button
                              type="button"
                              className="ghost small"
                              onClick={() => setActiveModal({ type: 'payment', target: user })}
                            >
                              <ReceiptText size={15} /> Pago
                            </button>
                            <button
                              type="button"
                              className="ghost small"
                              onClick={() => setActiveModal({ type: 'edit-user', target: user })}
                            >
                              <Edit size={15} /> Mover
                            </button>
                            <button
                              type="button"
                              className={`ghost small ${user.status === 'active' ? 'danger' : ''}`}
                              onClick={() => setActiveModal({ type: 'toggle-user-status', target: user })}
                            >
                              {user.status === 'active' ? 'Desactivar' : 'Activar'}
                            </button>
                            {user.status === 'active' ? (
                              <button
                                type="button"
                                className="ghost small"
                                onClick={() => setActiveModal({ type: 'independize', target: user })}
                              >
                                <Split size={14} /> Independizar
                              </button>
                            ) : null}
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
        </div>
      </div>

      {activeSection === 'catalogo' && selectedProductIds.length > 0 ? (
        <footer className="admin-bulk-bar">
          <div
            className="admin-bulk-count"
            aria-live="polite"
            aria-label={`${selectedProductIds.length} producto${selectedProductIds.length === 1 ? '' : 's'} seleccionado${selectedProductIds.length === 1 ? '' : 's'}`}
          >
            <strong>{selectedProductIds.length}</strong>
            <CircleCheck size={18} aria-hidden="true" />
          </div>
          <div className="admin-bulk-actions">
            <button type="button" onClick={() => openBulkAction('purchase')} aria-label="Registrar compra">
              <PackagePlus size={17} />
              <span>Compra</span>
            </button>
            <button type="button" onClick={() => openBulkAction('inventory')} aria-label="Cuadre de inventario">
              <Boxes size={17} />
              <span className="admin-bulk-label-full">Inventario</span>
              <span className="admin-bulk-label-short" aria-hidden="true">Inv.</span>
            </button>
            <button type="button" onClick={() => openBulkAction('prices')} aria-label="Actualizar precios">
              <DollarSign size={17} />
              <span className="admin-bulk-label-full">Precio</span>
            </button>
          </div>
          <button
            type="button"
            className="ghost admin-bulk-clear"
            onClick={() => setSelectedProductIds([])}
            aria-label="Limpiar seleccion"
            title="Limpiar seleccion"
          >
            <BrushCleaning size={17} />
          </button>
        </footer>
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
  const activeAccounts = data.accounts.filter((a) => a.status === 'active');
  const activeUsers = data.users.filter((u) => u.status === 'active');
  const targetAccountId =
    typeof modal.target?.accountId === 'string'
      ? modal.target.accountId
      : typeof modal.target?.id === 'string' && ['payment', 'adjustment', 'account-detail', 'merge'].includes(modal.type)
        ? modal.target.id
        : data.accounts[0]?.id ?? '';
  const targetProductId =
    typeof modal.target?.id === 'string' && ['purchase', 'stock-adjustment'].includes(modal.type)
      ? modal.target.id
      : data.products.find((p) => p.status === 'active')?.id ?? '';

  // Registrar pago
  const [paymentAccount, setPaymentAccount] = useState(targetAccountId);
  const [paymentTargetType, setPaymentTargetType] = useState(
    modal.type === 'payment' && typeof modal.target?.accountId === 'string' ? 'user' : 'account'
  );
  const paymentUsers = data.users.filter((u) => u.accountId === paymentAccount && u.status === 'active');

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
          await adminApi.createAccount({ name: String(form.get('name') ?? '') }, adminSession);
          onMessage('Cuenta creada.');
          break;

        case 'create-user':
          await adminApi.createUser({
            accountId: String(form.get('accountId')),
            name: String(form.get('name') ?? ''),
            pin: String(form.get('pin') ?? '1234')
          }, adminSession);
          onMessage('Usuario creado.');
          break;

        case 'payment':
          await adminApi.createPayment({
            accountId: String(form.get('accountId')),
            targetType: paymentTargetType === 'user' ? 'user' : 'account',
            userId: paymentTargetType === 'user' ? String(form.get('userId')) : undefined,
            amount: toNumber(form.get('amount')),
            note: String(form.get('note') ?? '')
          }, adminSession);
          onMessage('Pago registrado.');
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
              accountId: String(form.get('accountId') ?? modal.target.accountId),
              name: String(form.get('name') ?? ''),
              newPin: newPin || undefined
            },
            adminSession
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
              const quantityDelta = Number(form.get(`quantityDelta-${product.id}`));
              if (!Number.isFinite(quantityDelta) || quantityDelta === 0) continue;
              await adminApi.adjustInventory(
                {
                  productId: product.id,
                  quantityDelta,
                  note: String(form.get(`note-${product.id}`) ?? 'Ajuste masivo de inventario')
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
  const detailConsumptions = detailAccount
    ? data.consumptions.filter((entry) => entry.accountId === detailAccount.id).slice(0, 8)
    : [];

  return (
    <div className="modal-backdrop">
      <div className={`modal admin-action-modal ${modal.type === 'bulk-products' ? 'wide admin-bulk-modal' : ''}`}>
        <div className="admin-modal-title-row">
          <h2>
            {modal.type === 'create-account' && 'Crear Nueva Cuenta'}
            {modal.type === 'create-user' && 'Crear Nuevo Usuario'}
            {modal.type === 'payment' && 'Registrar Pago'}
            {modal.type === 'adjustment' && 'Realizar Ajuste Manual'}
            {modal.type === 'independize' && 'Independizar Usuario'}
            {modal.type === 'merge' && 'Unir Cuentas'}
            {modal.type === 'create-product' && 'Agregar Producto'}
            {modal.type === 'purchase' && 'Registrar Compra / Inventario'}
            {modal.type === 'stock-adjustment' && 'Ajuste de Stock'}
            {modal.type === 'export' && 'Exportar a Google Sheets'}
            {modal.type === 'edit-account' && 'Editar Cuenta'}
            {modal.type === 'edit-user' && 'Editar Usuario'}
            {modal.type === 'edit-product' && 'Editar Producto'}
            {modal.type === 'history' && 'Historial de Consumos'}
            {modal.type === 'account-detail' && 'Detalle de Cuenta'}
            {modal.type === 'toggle-product-status' &&
              (modal.target.status === 'active' ? 'Desactivar Producto' : 'Activar Producto')}
            {modal.type === 'toggle-user-status' &&
              (modal.target.status === 'active' ? 'Desactivar Usuario' : 'Activar Usuario')}
            {modal.type === 'bulk-products' && bulkMode === 'purchase' && 'Compra de Productos'}
            {modal.type === 'bulk-products' && bulkMode === 'inventory' && 'Cuadre de Inventario'}
            {modal.type === 'bulk-products' && bulkMode === 'prices' && 'Actualizar Precios'}
          </h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        {modal.type === 'account-detail' && detailAccount ? (
          <div className="admin-history-modal-body account-detail-modal-body">
            <div className="admin-detail-summary">
              <span>Saldo total</span>
              <strong>{formatMoney(detailBalance?.balance ?? 0)}</strong>
              <small>{detailUsers.length} usuario{detailUsers.length === 1 ? '' : 's'} vinculado{detailUsers.length === 1 ? '' : 's'}</small>
            </div>

            <div className="admin-users-sublist detail">
              {detailUsers.map((user) => {
                const userBalance = detailBalance?.users.find((entry) => entry.userId === user.id)?.balance ?? 0;
                return (
                  <div key={user.id} className={`admin-user-row ${user.status === 'inactive' ? 'is-inactive' : ''}`}>
                    <span>
                      {user.name} <small className="muted">{user.status === 'active' ? 'activo' : 'inactivo'}</small>
                    </span>
                    <span className="user-row-balance">{formatMoney(userBalance)}</span>
                  </div>
                );
              })}
            </div>

            <div className="table-list">
              {detailConsumptions.map((consumption) => {
                const user = data.users.find((entry) => entry.id === consumption.userId);
                const consumptionItems = data.items.filter((item) => item.consumptionId === consumption.id);
                return (
                  <div className="history-row" key={consumption.id}>
                    <div>
                      <strong>{formatMoney(consumption.total)}</strong>
                      <p>
                        {user?.name} / {new Date(consumption.createdAt).toLocaleString('es-CO')}
                      </p>
                      <small>
                        {consumptionItems.map((item) => `${item.productName} x${item.quantity}`).join(', ')}
                      </small>
                    </div>
                    <span className={consumption.status === 'voided' ? 'danger-text' : 'status-pill ok'}>
                      {consumption.status}
                    </span>
                  </div>
                );
              })}
              {detailConsumptions.length === 0 ? <p className="admin-empty-state compact">Sin consumos registrados.</p> : null}
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost" onClick={onClose}>
                Cerrar
              </button>
              <button type="button" className="secondary" onClick={() => onSwitchModal?.({ type: 'merge', target: detailAccount })}>
                Unir cuentas
              </button>
            </div>
          </div>
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
              <input name="name" placeholder="Nombre de familia o grupo" required autoFocus />
            )}

            {modal.type === 'create-user' && (
              <div className="create-user-flow">
                <div className="admin-form-note">
                  <span className="admin-form-note-icon" aria-hidden="true">
                    <Users size={20} />
                  </span>
                  <div>
                    <strong>Datos de acceso del usuario</strong>
                    <p>El usuario podra entrar con este nombre y PIN. Sus compras quedaran cargadas a la cuenta seleccionada.</p>
                  </div>
                </div>

                <label className="admin-field-stack">
                  <span>1. Cuenta donde quedara vinculado</span>
                  <select name="accountId" defaultValue={targetAccountId} required>
                    {activeAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                  <small>Selecciona la cuenta/familia que asumira los consumos de este usuario.</small>
                </label>

                <label className="admin-field-stack">
                  <span>2. Nombre para iniciar sesion</span>
                  <input name="name" placeholder="Ej: Papa, Mama, Hijo" autoComplete="off" required autoFocus />
                  <small>Debe ser facil de reconocer en la pantalla de inicio.</small>
                </label>

                <div className="admin-field-stack">
                  <span>3. PIN de entrada</span>
                <input name="pin" placeholder="PIN de 4 dígitos" inputMode="numeric" defaultValue="1234" required />
                  <small>Usa 4 numeros. El PIN inicial sugerido es 1234.</small>
                </div>

                <div className="create-user-summary">
                  <span>Antes de guardar</span>
                  <strong>Quedara activo inmediatamente</strong>
                  <small>El usuario podra entrar al kiosko con el nombre y PIN que acabas de definir.</small>
                </div>
              </div>
            )}

            {modal.type === 'payment' && (
              <>
                <label>Cuenta origen</label>
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
                <label>Destinatario</label>
                <select value={paymentTargetType} onChange={(e) => setPaymentTargetType(e.target.value)}>
                  <option value="account">Abonar a cuenta completa</option>
                  <option value="user">Abonar a usuario específico</option>
                </select>
                {paymentTargetType === 'user' && (
                  <>
                    <label>Usuario</label>
                    <select name="userId" required>
                      {paymentUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <input name="amount" placeholder="Monto del pago" inputMode="numeric" required />
                <input name="note" placeholder="Nota o concepto opcional" />
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
                <label>Cuenta asociada</label>
                <select name="accountId" defaultValue={modal.target.accountId} required>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <label>Nombre del usuario</label>
                <input name="name" defaultValue={modal.target.name} required />
                <label>PIN de seguridad (dejar vacío para no modificar)</label>
                <input name="pin" placeholder="Nuevo PIN opcional" inputMode="numeric" />
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
                            Ajuste
                            <input name={`quantityDelta-${product.id}`} inputMode="numeric" placeholder="0" />
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

            {modal.type === 'toggle-user-status' && (
              <p className="admin-confirm-copy">
                {modal.target.status === 'active'
                  ? `El usuario "${modal.target.name}" quedara inactivo para nuevas acciones.`
                  : `El usuario "${modal.target.name}" volvera a estar activo.`}
              </p>
            )}

            <div className="modal-actions">
              {modal.type !== 'create-product' && modal.type !== 'edit-product' ? (
                <button type="button" className="ghost" onClick={onClose}>
                  Cancelar
                </button>
              ) : null}
              <button type="submit" className="primary" disabled={modal.type === 'create-user' && activeAccounts.length === 0}>
                {modal.type === 'toggle-product-status' || modal.type === 'toggle-user-status' || modal.type === 'bulk-products'
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
