import type { AppSession } from '../domain/types';
import { getSupabaseClient, isSyncConfigured } from './sync';

export const PRODUCT_IMAGE_BUCKET = 'product-images';
export const PRODUCT_IMAGE_MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const PRODUCT_IMAGE_MAX_DIMENSION = 1200;

export type UploadedProductImage = {
  path: string;
  url: string;
};

type MigrationResult = {
  migrated: number;
  failed: number;
};

function requireAdminSession(session?: AppSession): AppSession {
  if (!isSyncConfigured()) throw new Error('Supabase no esta configurado.');
  if (!session?.token || session.role !== 'admin') throw new Error('Sesion de administrador requerida.');
  return session;
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      try {
        const body = await response.clone().json() as { error?: unknown };
        if (typeof body.error === 'string' && body.error) return body.error;
      } catch {
        // Fall through to the SDK message.
      }
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.')),
      type,
      quality
    );
  });
}

async function loadImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close()
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;
  await image.decode();
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dispose: () => URL.revokeObjectURL(objectUrl)
  };
}

export async function compressProductImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen.');
  if (file.size <= 0 || file.size > PRODUCT_IMAGE_MAX_INPUT_BYTES) {
    throw new Error('La imagen original debe pesar maximo 15 MB.');
  }

  const loaded = await loadImage(file);
  try {
    const scale = Math.min(1, PRODUCT_IMAGE_MAX_DIMENSION / Math.max(loaded.width, loaded.height));
    const width = Math.max(1, Math.round(loaded.width * scale));
    const height = Math.max(1, Math.round(loaded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Este navegador no puede procesar imagenes.');
    context.drawImage(loaded.source, 0, 0, width, height);

    let result = await canvasBlob(canvas, 'image/webp', 0.82);
    if (result.type !== 'image/webp') result = await canvasBlob(canvas, 'image/jpeg', 0.82);
    for (const quality of [0.72, 0.62, 0.52]) {
      if (result.size <= PRODUCT_IMAGE_MAX_UPLOAD_BYTES) break;
      result = await canvasBlob(canvas, result.type === 'image/webp' ? 'image/webp' : 'image/jpeg', quality);
    }
    if (result.size > PRODUCT_IMAGE_MAX_UPLOAD_BYTES) {
      throw new Error('La imagen sigue siendo demasiado pesada despues de comprimirla.');
    }
    return result;
  } finally {
    loaded.dispose();
  }
}

export async function uploadProductImage(blob: Blob, session?: AppSession): Promise<UploadedProductImage> {
  const activeSession = requireAdminSession(session);
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase no esta configurado.');
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const body = new FormData();
  body.set('action', 'upload');
  body.set('sessionToken', activeSession.token);
  body.set('file', new File([blob], `product.${extension}`, { type: blob.type }));
  const { data, error } = await supabase.functions.invoke('product-image', { body });
  if (error) throw new Error(await functionErrorMessage(error, 'No se pudo subir la imagen.'));
  const result = (data ?? {}) as Partial<UploadedProductImage> & { error?: string };
  if (result.error) throw new Error(result.error);
  if (!result.path || !result.url) throw new Error('Storage devolvio una respuesta invalida.');
  return { path: result.path, url: result.url };
}

export async function deleteProductImage(path: string, session?: AppSession): Promise<void> {
  const activeSession = requireAdminSession(session);
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase.functions.invoke('product-image', {
    method: 'DELETE',
    body: { action: 'delete', sessionToken: activeSession.token, path }
  });
  if (error) throw new Error(await functionErrorMessage(error, 'No se pudo eliminar la imagen anterior.'));
}

export async function migrateLegacyProductImages(session?: AppSession): Promise<MigrationResult> {
  const activeSession = requireAdminSession(session);
  const supabase = getSupabaseClient();
  if (!supabase) return { migrated: 0, failed: 0 };
  const { data, error } = await supabase.functions.invoke('product-image', {
    body: { action: 'migrate', sessionToken: activeSession.token }
  });
  if (error) throw new Error(await functionErrorMessage(error, 'No se pudieron migrar las imagenes anteriores.'));
  const result = (data ?? {}) as Partial<MigrationResult>;
  return {
    migrated: Number(result.migrated) || 0,
    failed: Number(result.failed) || 0
  };
}

export function productImageStoragePath(urlValue: string | undefined): string | null {
  if (!urlValue) return null;
  try {
    const url = new URL(urlValue);
    const marker = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
    const index = url.pathname.indexOf(marker);
    return index >= 0 ? decodeURIComponent(url.pathname.slice(index + marker.length)) : null;
  } catch {
    return null;
  }
}
