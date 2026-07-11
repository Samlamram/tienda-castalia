import { db } from '../data/db';
import type { AppSession, CatalogProduct, Product } from '../domain/types';
import { nowIso } from '../utils/id';
import { getSupabaseClient, isSyncConfigured } from './sync';

type CatalogPayload = {
  version?: number;
  catalogVersion?: number;
  catalog_version?: number;
  products?: unknown[];
  user?: Record<string, unknown>;
  account?: Record<string, unknown>;
  balance?: number;
};

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function mapCatalogProduct(value: unknown): CatalogProduct {
  const row = value as Record<string, unknown>;
  const updatedAt = stringValue(row.updatedAt ?? row.updated_at, nowIso());
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    category: stringValue(row.category, 'General'),
    price: numberValue(row.price),
    imageUrl: row.imageUrl || row.image_url ? stringValue(row.imageUrl ?? row.image_url) : undefined,
    imageSourceUrl: row.imageSourceUrl || row.image_source_url
      ? stringValue(row.imageSourceUrl ?? row.image_source_url)
      : undefined,
    imageCredit: row.imageCredit || row.image_credit ? stringValue(row.imageCredit ?? row.image_credit) : undefined,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    version: numberValue(row.version, 1),
    updatedAt
  };
}

export function catalogProductToProduct(product: CatalogProduct): Product {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    stockMin: 0,
    lastCost: 0,
    imageUrl: product.imageUrl,
    imageSourceUrl: product.imageSourceUrl,
    imageCredit: product.imageCredit,
    status: product.status,
    createdAt: product.updatedAt,
    updatedAt: product.updatedAt,
    version: product.version
  };
}

export async function getCachedCatalogVersion(): Promise<number> {
  const setting = await db.settings.get('catalog_version');
  return numberValue(setting?.value, 0);
}

export async function refreshCatalog(session: AppSession): Promise<AppSession> {
  if (!isSyncConfigured() || session.role !== 'user') return session;
  const supabase = getSupabaseClient();
  if (!supabase) return session;

  const sinceVersion = await getCachedCatalogVersion();
  const { data, error } = await supabase.rpc('get_user_catalog', {
    p_session_token: session.token,
    p_since_version: sinceVersion
  });

  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as CatalogPayload;
  const version = numberValue(payload.catalogVersion ?? payload.catalog_version ?? payload.version, sinceVersion);
  const products = Array.isArray(payload.products) ? payload.products.map(mapCatalogProduct) : [];

  await db.transaction('rw', db.catalogProducts, db.settings, db.appSessions, async () => {
    if (products.length > 0 || version !== sinceVersion) {
      if (products.length > 0) {
        await db.catalogProducts.bulkPut(products);
      }
      await db.settings.put({ key: 'catalog_version', value: String(version) });
    }

    const account = payload.account ?? {};
    const user = payload.user ?? {};
    const updated: AppSession = {
      ...session,
      userName: stringValue(user.name ?? user.userName ?? user.user_name, session.userName),
      accountId: account.id || session.accountId ? stringValue(account.id, session.accountId) : undefined,
      accountName: account.name || session.accountName ? stringValue(account.name, session.accountName) : undefined,
      balance: numberValue(payload.balance, session.balance ?? 0),
      updatedAt: nowIso()
    };
    await db.appSessions.put(updated);
  });

  return (await db.appSessions.get('current')) ?? session;
}
