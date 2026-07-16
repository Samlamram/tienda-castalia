import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct } from '../domain/types';
import { cacheCatalogImages } from './imageCache';

function product(id: string, imageUrl?: string): CatalogProduct {
  return {
    id,
    name: id,
    category: 'General',
    price: 1,
    imageUrl,
    status: 'active',
    version: 1,
    updatedAt: '2026-07-16T00:00:00.000Z'
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('cache local de imagenes', () => {
  it('descarga una sola vez cada URL http y omite Base64', async () => {
    const entries = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (url: string) => entries.get(url)),
      put: vi.fn(async (url: string, response: Response) => { entries.set(url, response); }),
      keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
      delete: vi.fn(async (request: Request) => entries.delete(request.url))
    };
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    const fetchMock = vi.fn(async () => new Response('image', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await cacheCatalogImages([
      product('a', 'https://cdn.example.com/a.webp'),
      product('b', 'https://cdn.example.com/a.webp'),
      product('c', 'data:image/jpeg;base64,abc')
    ]);
    await cacheCatalogImages([product('a', 'https://cdn.example.com/a.webp')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
});
