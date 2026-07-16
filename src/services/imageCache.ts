import type { CatalogProduct } from '../domain/types';

export const PRODUCT_IMAGE_CACHE = 'catalog-images';
const MAX_CACHE_ENTRIES = 250;
const DOWNLOAD_CONCURRENCY = 4;

function cacheableUrl(value: string | undefined): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

async function cacheOne(cache: Cache, url: string): Promise<void> {
  if (await cache.match(url)) return;
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok && response.type !== 'opaque') throw new Error(`No se pudo guardar ${url}`);
  await cache.put(url, response);
}

async function prune(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHE_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((request) => cache.delete(request)));
}

export async function cacheCatalogImages(products: CatalogProduct[]): Promise<void> {
  if (typeof caches === 'undefined' || typeof fetch === 'undefined') return;
  const urls = [...new Set(products.map((product) => product.imageUrl).filter(cacheableUrl))]
    .slice(0, MAX_CACHE_ENTRIES);
  if (urls.length === 0) return;
  const cache = await caches.open(PRODUCT_IMAGE_CACHE);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, urls.length) }, async () => {
    while (cursor < urls.length) {
      const url = urls[cursor];
      cursor += 1;
      await cacheOne(cache, url).catch(() => undefined);
    }
  });
  await Promise.all(workers);
  await prune(cache);
}

export async function requestPersistentLocalStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
