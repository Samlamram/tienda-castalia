import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

const BUCKET = 'product-images';
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_LEGACY_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS'
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function extensionFor(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

function storagePathFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const index = url.pathname.indexOf(marker);
    return index >= 0 ? decodeURIComponent(url.pathname.slice(index + marker.length)) : null;
  } catch {
    return null;
  }
}

function parseDataUrl(value: string): { bytes: Uint8Array; type: string } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return null;
  const binary = atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, type: match[1].toLowerCase() };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json({ error: 'Metodo no permitido.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Storage no esta configurado.' }, 500);

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const contentType = request.headers.get('content-type') ?? '';
    const payload = contentType.includes('multipart/form-data')
      ? await request.formData()
      : await request.json();
    const sessionToken = payload instanceof FormData
      ? String(payload.get('sessionToken') ?? '')
      : String(payload?.sessionToken ?? '');

    const { error: authError } = await service.rpc('storage_require_admin', {
      p_session_token: sessionToken
    });
    if (authError) return json({ error: authError.message }, 401);

    const action = payload instanceof FormData
      ? String(payload.get('action') ?? 'upload')
      : String(payload?.action ?? (request.method === 'DELETE' ? 'delete' : 'upload'));

    if (action === 'delete') {
      const path = payload instanceof FormData ? String(payload.get('path') ?? '') : String(payload?.path ?? '');
      if (!path.startsWith('products/') || path.includes('..')) return json({ error: 'Ruta de imagen invalida.' }, 400);
      const { error } = await service.storage.from(BUCKET).remove([path]);
      if (error) return json({ error: error.message }, 400);
      return json({ status: 'deleted' });
    }

    if (action === 'migrate') {
      const { data: products, error: queryError } = await service
        .from('products')
        .select('id,image_url')
        .like('image_url', 'data:image/%');
      if (queryError) return json({ error: queryError.message }, 400);

      let migrated = 0;
      const failures: Array<{ productId: string; error: string }> = [];
      for (const product of products ?? []) {
        const oldUrl = String(product.image_url ?? '');
        try {
          const parsed = parseDataUrl(oldUrl);
          if (!parsed || parsed.bytes.byteLength > MAX_LEGACY_BYTES) {
            throw new Error('La imagen Base64 es invalida o supera 10 MB.');
          }
          const path = `products/${product.id}/${crypto.randomUUID()}.${extensionFor(parsed.type)}`;
          const { error: uploadError } = await service.storage.from(BUCKET).upload(path, parsed.bytes, {
            contentType: parsed.type,
            cacheControl: '31536000',
            upsert: false
          });
          if (uploadError) throw uploadError;
          const publicUrl = service.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
          const { data: replaced, error: replaceError } = await service.rpc('storage_replace_product_image', {
            p_session_token: sessionToken,
            p_product_id: product.id,
            p_expected_image_url: oldUrl,
            p_new_image_url: publicUrl
          });
          if (replaceError || !replaced) {
            await service.storage.from(BUCKET).remove([path]);
            throw replaceError ?? new Error('El producto cambio durante la migracion.');
          }
          migrated += 1;
        } catch (error) {
          failures.push({ productId: String(product.id), error: error instanceof Error ? error.message : String(error) });
        }
      }
      return json({ migrated, failed: failures.length, failures });
    }

    if (!(payload instanceof FormData)) return json({ error: 'Se esperaba una imagen.' }, 400);
    const file = payload.get('file');
    if (!(file instanceof File)) return json({ error: 'Selecciona una imagen.' }, 400);
    if (!ALLOWED_TYPES.has(file.type)) return json({ error: 'Formato de imagen no permitido.' }, 400);
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return json({ error: 'La imagen optimizada debe pesar maximo 2 MB.' }, 400);
    }

    const path = `products/${crypto.randomUUID()}.${extensionFor(file.type)}`;
    const { error: uploadError } = await service.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false
    });
    if (uploadError) return json({ error: uploadError.message }, 400);
    const publicUrl = service.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    return json({ path, url: publicUrl });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo procesar la imagen.' }, 400);
  }
});
