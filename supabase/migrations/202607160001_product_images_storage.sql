begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Avoid copying legacy Base64 payloads into the immutable audit log while
-- retaining evidence that the image field existed and changed.
create or replace function public.app_redact_json(p_value jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_result jsonb;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value) = 'object' then
    select coalesce(
      jsonb_object_agg(
        key,
        case
          when lower(key) in ('imageurl', 'image_url')
            and jsonb_typeof(value) = 'string'
            and value #>> '{}' like 'data:image/%'
          then to_jsonb('[imagen Base64 omitida]'::text)
          else public.app_redact_json(value)
        end
      ),
      '{}'::jsonb
    ) into v_result
    from jsonb_each(p_value)
    where lower(key) not in (
      'pin', 'newpin', 'currentpin', 'new_pin', 'current_pin',
      'pinhash', 'pinsalt', 'pin_hash', 'pin_salt',
      'token', 'tokenhash', 'token_hash',
      'sessiontoken', 'session_token', 'psessiontoken', 'p_session_token',
      'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
      'authorization'
    );
    return v_result;
  end if;
  if jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public.app_redact_json(value)), '[]'::jsonb)
      into v_result from jsonb_array_elements(p_value);
    return v_result;
  end if;
  return p_value;
end;
$$;

-- Storage does not understand the application's custom PIN sessions. These
-- service-role-only helpers let the Edge Function validate an administrator
-- and preserve the normal product version/audit triggers during migration.
create or replace function public.storage_require_admin(p_session_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.app_users%rowtype;
begin
  v_admin := public.app_require_admin(p_session_token);
  return v_admin.id;
end;
$$;

create or replace function public.storage_replace_product_image(
  p_session_token text,
  p_product_id uuid,
  p_expected_image_url text,
  p_new_image_url text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.app_users%rowtype;
begin
  v_admin := public.app_require_admin(p_session_token);
  perform public.app_set_context(
    v_admin.id,
    v_admin.name,
    gen_random_uuid(),
    null,
    'Migracion de imagen de producto a Supabase Storage'
  );

  update public.products
     set image_url = nullif(trim(coalesce(p_new_image_url, '')), '')
   where id = p_product_id
     and image_url is not distinct from p_expected_image_url;

  return found;
end;
$$;

revoke all on function public.storage_require_admin(text) from public, anon, authenticated;
revoke all on function public.storage_replace_product_image(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.storage_require_admin(text) to service_role;
grant execute on function public.storage_replace_product_image(text, uuid, text, text)
  to service_role;

commit;
