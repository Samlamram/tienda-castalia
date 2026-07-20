-- APP_TIENDA - esquema base v2
-- Este archivo es destructivo a proposito: los datos anteriores eran demostrativos.
-- Supabase/PostgreSQL 15+

begin;

create extension if not exists pgcrypto;

drop function if exists public.login_pin(text, text, text);
drop function if exists public.app_user_balance(text);
drop function if exists public.recalculate_fifo_costs(text);
drop function if exists public.admin_get_audit_log(text, integer, integer, text, text, text, timestamptz, timestamptz);
drop function if exists public.admin_get_audit_log(text, integer, integer, text, text, text, text, timestamptz, timestamptz);
drop function if exists public.admin_get_export_data(text, timestamptz, timestamptz);
drop function if exists public.app_filter_json_by_date(jsonb, timestamptz, timestamptz);

drop view if exists public.consumption_payment_status cascade;
drop view if exists public.account_balances cascade;
drop view if exists public.user_balances cascade;
drop view if exists public.consumption_costs cascade;
drop view if exists public.product_stock cascade;

drop table if exists public.sync_operations cascade;
drop table if exists public.admin_audit_log cascade;
drop table if exists public.account_transfers cascade;
drop table if exists public.adjustments cascade;
drop table if exists public.purchases cascade;
drop table if exists public.payments cascade;
drop table if exists public.audit_log cascade;
drop table if exists public.fifo_cost_allocations cascade;
drop table if exists public.inventory_movements cascade;
drop table if exists public.payment_applications cascade;
drop table if exists public.financial_movements cascade;
drop table if exists public.consumption_void_requests cascade;
drop table if exists public.consumption_items cascade;
drop table if exists public.consumptions cascade;
drop table if exists public.products cascade;
drop table if exists public.app_sessions cascade;
drop table if exists public.app_users cascade;
drop table if exists public.accounts cascade;
drop sequence if exists public.catalog_version_seq cascade;

create sequence public.catalog_version_seq as bigint start with 1;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint accounts_archive_state_ck check (
    (status = 'active' and archived_at is null and archive_reason is null)
    or
    (status = 'inactive' and archived_at is not null and nullif(trim(archive_reason), '') is not null)
  )
);

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id),
  username text not null check (username = lower(trim(username)) and length(username) between 2 and 80),
  name text not null check (length(trim(name)) between 1 and 120),
  role text not null default 'user' check (role in ('admin', 'user')),
  pin_salt text not null,
  pin_hash text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz,
  archived_by uuid references public.app_users(id),
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint app_users_archive_state_ck check (
    (status = 'active' and archived_at is null and archive_reason is null)
    or
    (status = 'inactive' and archived_at is not null and nullif(trim(archive_reason), '') is not null)
  )
);

alter table public.accounts
  add constraint accounts_archived_by_fk foreign key (archived_by) references public.app_users(id);

create unique index app_users_username_uidx on public.app_users (lower(username));
create index app_users_account_idx on public.app_users (account_id, status);

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references public.app_users(id),
  device_id text not null check (length(trim(device_id)) between 1 and 200),
  device_mode text not null default 'shared' check (device_mode in ('personal', 'shared')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index app_sessions_user_idx on public.app_sessions (user_id, expires_at);
create index app_sessions_expiry_idx on public.app_sessions (expires_at);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  category text not null default 'General' check (length(trim(category)) between 1 and 100),
  price numeric(14,2) not null default 0 check (price >= 0),
  stock_min numeric(14,3) not null default 0 check (stock_min >= 0),
  image_url text,
  image_source_url text,
  image_credit text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz,
  archived_by uuid references public.app_users(id),
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default nextval('public.catalog_version_seq') check (version > 0),
  constraint products_archive_state_ck check (
    (status = 'active' and archived_at is null and archive_reason is null)
    or
    (status = 'inactive' and archived_at is not null and nullif(trim(archive_reason), '') is not null)
  )
);

create index products_catalog_idx on public.products (version, updated_at);
create index products_status_name_idx on public.products (status, name);

create table public.consumptions (
  id uuid primary key default gen_random_uuid(),
  client_operation_id uuid not null unique,
  account_id uuid references public.accounts(id),
  user_id uuid not null references public.app_users(id),
  device_id text,
  catalog_version bigint not null default 0,
  status text not null default 'confirmed' check (status in ('confirmed', 'voided')),
  total numeric(14,2) not null check (total > 0),
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz,
  voided_by uuid references public.app_users(id),
  void_reason text,
  constraint consumptions_void_state_ck check (
    (status = 'confirmed' and voided_at is null and voided_by is null and void_reason is null)
    or
    (status = 'voided' and voided_at is not null and voided_by is not null and nullif(trim(void_reason), '') is not null)
  )
);

create index consumptions_user_created_idx on public.consumptions (user_id, created_at, id);
create index consumptions_account_created_idx on public.consumptions (account_id, created_at, id);
create index consumptions_request_idx on public.consumptions (request_id);

create table public.consumption_items (
  id uuid primary key default gen_random_uuid(),
  consumption_id uuid not null references public.consumptions(id),
  account_id uuid references public.accounts(id),
  user_id uuid not null references public.app_users(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default clock_timestamp(),
  unique (consumption_id, product_id)
);

create index consumption_items_product_idx on public.consumption_items (product_id, created_at, id);
create index consumption_items_user_idx on public.consumption_items (user_id, created_at, id);

create table public.financial_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null check (
    movement_type in ('payment', 'adjustment', 'account_transfer', 'payment_reversal', 'adjustment_reversal')
  ),
  account_id uuid references public.accounts(id),
  scope text not null check (scope in ('account', 'user')),
  user_id uuid references public.app_users(id),
  paid_by_user_id uuid references public.app_users(id),
  amount numeric(14,2) not null,
  from_account_id uuid references public.accounts(id),
  to_account_id uuid references public.accounts(id),
  reversed_movement_id uuid unique references public.financial_movements(id),
  note text,
  created_by uuid references public.app_users(id),
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  constraint financial_movements_shape_ck check (
    (
      movement_type in ('payment', 'payment_reversal')
      and paid_by_user_id is not null
      and amount <> 0
      and (
        (scope = 'user' and user_id is not null)
        or
        (scope = 'account' and account_id is not null)
      )
    )
    or
    (
      movement_type in ('adjustment', 'adjustment_reversal')
      and amount <> 0
      and (
        (scope = 'user' and user_id is not null)
        or
        (scope = 'account' and account_id is not null)
      )
    )
    or
    (
      movement_type = 'account_transfer'
      and (
        (scope = 'user' and user_id is not null)
        or
        (scope = 'account' and user_id is null and account_id = to_account_id)
      )
      and from_account_id is distinct from to_account_id
    )
  ),
  constraint financial_movements_reversal_ck check (
    (movement_type in ('payment_reversal', 'adjustment_reversal')) = (reversed_movement_id is not null)
  ),
  constraint financial_movements_payment_sign_ck check (
    (movement_type = 'payment' and amount > 0)
    or
    (movement_type = 'payment_reversal' and amount < 0)
    or
    movement_type not in ('payment', 'payment_reversal')
  )
);

create index financial_movements_user_idx on public.financial_movements (user_id, created_at, id);
create index financial_movements_account_idx on public.financial_movements (account_id, created_at, id);
create index financial_movements_payer_idx on public.financial_movements (paid_by_user_id, created_at, id);
create index financial_movements_request_idx on public.financial_movements (request_id);

create table public.payment_applications (
  id uuid primary key default gen_random_uuid(),
  financial_movement_id uuid not null references public.financial_movements(id),
  consumption_id uuid not null references public.consumptions(id),
  account_id uuid references public.accounts(id),
  user_id uuid not null references public.app_users(id),
  amount numeric(14,2) not null check (amount <> 0),
  reversed_application_id uuid unique references public.payment_applications(id),
  created_by uuid references public.app_users(id),
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  constraint payment_applications_reversal_sign_ck check (
    (reversed_application_id is null and amount > 0)
    or
    (reversed_application_id is not null and amount < 0)
  )
);

create index payment_applications_movement_idx on public.payment_applications (financial_movement_id, created_at, id);
create index payment_applications_consumption_idx on public.payment_applications (consumption_id, created_at, id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  movement_type text not null check (
    movement_type in ('purchase', 'consumption', 'void_consumption', 'adjustment', 'adjustment_reversal')
  ),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(14,2),
  consumption_item_id uuid references public.consumption_items(id),
  reversed_movement_id uuid unique references public.inventory_movements(id),
  note text,
  created_by uuid references public.app_users(id),
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  constraint inventory_movements_cost_ck check (
    unit_cost is null or unit_cost >= 0
  ),
  constraint inventory_movements_shape_ck check (
    (movement_type = 'purchase' and quantity_delta > 0 and unit_cost is not null and consumption_item_id is null)
    or
    (movement_type = 'consumption' and quantity_delta < 0 and consumption_item_id is not null)
    or
    (movement_type = 'void_consumption' and quantity_delta > 0 and consumption_item_id is not null and reversed_movement_id is not null)
    or
    (movement_type = 'adjustment' and consumption_item_id is null)
    or
    (movement_type = 'adjustment_reversal' and consumption_item_id is null and reversed_movement_id is not null)
  )
);

create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at, id);
create index inventory_movements_item_idx on public.inventory_movements (consumption_item_id);
create index inventory_movements_request_idx on public.inventory_movements (request_id);

create table public.fifo_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  consumption_item_id uuid references public.consumption_items(id),
  source_movement_id uuid not null references public.inventory_movements(id),
  target_movement_id uuid not null references public.inventory_movements(id),
  quantity numeric(14,3) not null check (quantity <> 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  cost_total numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  reversed_allocation_id uuid unique references public.fifo_cost_allocations(id),
  created_by uuid references public.app_users(id),
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  constraint fifo_allocation_reversal_sign_ck check (
    (reversed_allocation_id is null and quantity > 0)
    or
    (reversed_allocation_id is not null and quantity < 0)
  )
);

create index fifo_allocations_source_idx on public.fifo_cost_allocations (source_movement_id, created_at, id);
create index fifo_allocations_target_idx on public.fifo_cost_allocations (target_movement_id, created_at, id);
create index fifo_allocations_item_idx on public.fifo_cost_allocations (consumption_item_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null default gen_random_uuid(),
  idempotency_key text,
  actor_user_id uuid references public.app_users(id),
  actor_name text,
  action text not null check (length(trim(action)) > 0),
  entity_type text not null check (length(trim(entity_type)) > 0),
  record_id uuid,
  before_data jsonb,
  after_data jsonb,
  changed_fields text[] not null default '{}'::text[],
  reason text,
  device_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create unique index audit_log_idempotency_uidx
  on public.audit_log (idempotency_key)
  where action = 'command' and idempotency_key is not null;
create index audit_log_created_idx on public.audit_log (created_at desc, id desc);
create index audit_log_entity_idx on public.audit_log (entity_type, record_id, created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_user_id, created_at desc);
create index audit_log_request_idx on public.audit_log (request_id, created_at, id);

-- Conversion tolerante: acepta UUID nativo y conserva idempotencia para identificadores
-- antiguos con prefijo mediante un UUID determinista.
create or replace function public.app_uuid(p_value text)
returns uuid
language plpgsql
immutable
strict
as $$
declare
  v_hex text;
begin
  begin
    return p_value::uuid;
  exception when invalid_text_representation then
    v_hex := md5(p_value);
    return (
      substr(v_hex, 1, 8) || '-' ||
      substr(v_hex, 9, 4) || '-' ||
      substr(v_hex, 13, 4) || '-' ||
      substr(v_hex, 17, 4) || '-' ||
      substr(v_hex, 21, 12)
    )::uuid;
  end;
end;
$$;

create or replace function public.app_context_uuid(p_name text)
returns uuid
language plpgsql
stable
as $$
declare
  v_value text;
begin
  v_value := nullif(current_setting(p_name, true), '');
  if v_value is null then
    return null;
  end if;
  return public.app_uuid(v_value);
end;
$$;

create or replace function public.app_hash_token(p_token text)
returns text
language sql
immutable
strict
as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;

create or replace function public.app_redact_json(p_value jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_result jsonb;
begin
  if p_value is null then
    return null;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    select coalesce(
      jsonb_object_agg(key, public.app_redact_json(value)),
      '{}'::jsonb
    )
      into v_result
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
      into v_result
    from jsonb_array_elements(p_value);
    return v_result;
  end if;

  return p_value;
end;
$$;

create or replace function public.app_set_context(
  p_actor_user_id uuid,
  p_actor_name text,
  p_request_id uuid,
  p_device_id text default null,
  p_reason text default null
)
returns void
language plpgsql
as $$
begin
  perform set_config('app.actor_user_id', coalesce(p_actor_user_id::text, ''), true);
  perform set_config('app.actor_name', coalesce(p_actor_name, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id::text, ''), true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);
  perform set_config('app.reason', coalesce(p_reason, ''), true);
end;
$$;

create or replace function public.app_prepare_archival()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'active' and new.status = 'inactive' then
    new.archived_at := coalesce(new.archived_at, now());
    new.archived_by := coalesce(new.archived_by, public.app_context_uuid('app.actor_user_id'));
    new.archive_reason := coalesce(
      nullif(trim(new.archive_reason), ''),
      nullif(current_setting('app.reason', true), ''),
      'Archivado'
    );
  elsif old.status = 'inactive' and new.status = 'active' then
    new.archived_at := null;
    new.archived_by := null;
    new.archive_reason := null;
  end if;
  return new;
end;
$$;

create or replace function public.app_touch_version()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function public.app_touch_product_version()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version := nextval('public.catalog_version_seq');
  return new;
end;
$$;

create or replace function public.app_block_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'No se permite eliminar %. Use archivo o un movimiento inverso.', tg_table_name;
end;
$$;

create or replace function public.app_block_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Los registros de % son inmutables. Use un movimiento inverso.', tg_table_name;
end;
$$;

create or replace function public.app_guard_consumption()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los consumos no se eliminan; deben anularse.';
  end if;

  if old.status = 'confirmed'
     and new.status = 'voided'
     and (to_jsonb(new) - array['status', 'voided_at', 'voided_by', 'void_reason'])
         = (to_jsonb(old) - array['status', 'voided_at', 'voided_by', 'void_reason'])
  then
    return new;
  end if;

  raise exception 'El consumo es inmutable; solo puede anularse una vez.';
end;
$$;

create or replace function public.app_guard_audit_log()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.action = 'command'
     and not (old.metadata ? 'response')
     and new.metadata ? 'response'
     and (to_jsonb(new) - 'metadata') = (to_jsonb(old) - 'metadata')
     and (new.metadata - 'response') = old.metadata
  then
    return new;
  end if;
  raise exception 'El historial de auditoria es inmutable.';
end;
$$;

create or replace function public.app_write_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_action text;
  v_record_id uuid;
  v_reason text;
  v_pin_changed boolean := false;
begin
  if current_setting('app.audit_disabled', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and tg_table_name = 'app_users' then
    v_pin_changed :=
      (to_jsonb(old)->'pin_hash') is distinct from (to_jsonb(new)->'pin_hash')
      or
      (to_jsonb(old)->'pin_salt') is distinct from (to_jsonb(new)->'pin_salt');
  end if;

  v_old := case when tg_op in ('UPDATE', 'DELETE') then public.app_redact_json(to_jsonb(old)) end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then public.app_redact_json(to_jsonb(new)) end;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}'::text[])
      into v_changed
    from (
      select key as k from jsonb_object_keys(v_old) as key
      union
      select key as k from jsonb_object_keys(v_new) as key
    ) keys
    where (v_old -> k) is distinct from (v_new -> k)
      and lower(k) not in (
        'pin', 'newpin', 'currentpin', 'new_pin', 'current_pin',
        'pin_hash', 'pin_salt', 'token', 'token_hash',
        'session_token', 'access_token', 'refresh_token',
        'updated_at', 'version', 'last_seen_at'
      );

    if cardinality(v_changed) = 0 and v_pin_changed then
      insert into public.audit_log(
        request_id, actor_user_id, actor_name, action, entity_type, record_id,
        changed_fields, reason, device_id
      )
      values (
        coalesce(public.app_context_uuid('app.request_id'), gen_random_uuid()),
        public.app_context_uuid('app.actor_user_id'),
        nullif(current_setting('app.actor_name', true), ''),
        'pin_changed',
        tg_table_name,
        public.app_uuid(v_new->>'id'),
        '{}'::text[],
        coalesce(nullif(current_setting('app.reason', true), ''), 'Cambio de PIN'),
        nullif(current_setting('app.device_id', true), '')
      );
      return new;
    elsif cardinality(v_changed) = 0 then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    select coalesce(array_agg(key order by key), '{}'::text[])
      into v_changed
    from jsonb_object_keys(v_new) as key
    where lower(key) not in ('pin_hash', 'pin_salt', 'token', 'token_hash');
  else
    select coalesce(array_agg(key order by key), '{}'::text[])
      into v_changed
    from jsonb_object_keys(v_old) as key
    where lower(key) not in ('pin_hash', 'pin_salt', 'token', 'token_hash');
  end if;

  if tg_op = 'INSERT' then
    if coalesce(v_new->>'movement_type', '') like '%_reversal'
       or (v_new->>'reversed_application_id') is not null
       or (v_new->>'reversed_allocation_id') is not null
    then
      v_action := 'reverse';
    else
      v_action := 'create';
    end if;
  elsif tg_op = 'DELETE'
        and tg_table_name = 'app_sessions'
        and nullif(current_setting('app.reason', true), '') = 'Cierre de sesion'
  then
    v_action := 'logout';
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
  elsif v_old->>'status' = 'active' and v_new->>'status' = 'inactive' then
    v_action := 'archive';
  elsif v_old->>'status' = 'inactive' and v_new->>'status' = 'active' then
    v_action := 'restore';
  elsif tg_table_name = 'consumptions'
        and v_old->>'status' = 'confirmed'
        and v_new->>'status' = 'voided'
  then
    v_action := 'void';
  else
    v_action := 'update';
  end if;

  v_record_id := public.app_uuid(coalesce(v_new->>'id', v_old->>'id'));
  v_reason := coalesce(
    nullif(current_setting('app.reason', true), ''),
    nullif(v_new->>'archive_reason', ''),
    nullif(v_new->>'void_reason', ''),
    nullif(v_new->>'note', '')
  );

  insert into public.audit_log(
    request_id, actor_user_id, actor_name, action, entity_type, record_id,
    before_data, after_data, changed_fields, reason, device_id
  )
  values (
    coalesce(public.app_context_uuid('app.request_id'), gen_random_uuid()),
    public.app_context_uuid('app.actor_user_id'),
    nullif(current_setting('app.actor_name', true), ''),
    v_action,
    tg_table_name,
    v_record_id,
    v_old,
    v_new,
    v_changed,
    v_reason,
    nullif(current_setting('app.device_id', true), '')
  );

  if v_pin_changed then
    insert into public.audit_log(
      request_id, actor_user_id, actor_name, action, entity_type, record_id,
      changed_fields, reason, device_id
    )
    values (
      coalesce(public.app_context_uuid('app.request_id'), gen_random_uuid()),
      public.app_context_uuid('app.actor_user_id'),
      nullif(current_setting('app.actor_name', true), ''),
      'pin_changed',
      tg_table_name,
      v_record_id,
      '{}'::text[],
      coalesce(nullif(current_setting('app.reason', true), ''), 'Cambio de PIN'),
      nullif(current_setting('app.device_id', true), '')
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger accounts_10_prepare_archive before update on public.accounts
for each row execute function public.app_prepare_archival();
create trigger accounts_20_touch before update on public.accounts
for each row execute function public.app_touch_version();
create trigger accounts_30_no_delete before delete on public.accounts
for each row execute function public.app_block_delete();

create trigger app_users_10_prepare_archive before update on public.app_users
for each row execute function public.app_prepare_archival();
create trigger app_users_20_touch before update on public.app_users
for each row execute function public.app_touch_version();
create trigger app_users_30_no_delete before delete on public.app_users
for each row execute function public.app_block_delete();

create trigger products_10_prepare_archive before update on public.products
for each row execute function public.app_prepare_archival();
create trigger products_20_touch before update on public.products
for each row execute function public.app_touch_product_version();
create trigger products_30_no_delete before delete on public.products
for each row execute function public.app_block_delete();

create trigger consumptions_10_guard before update or delete on public.consumptions
for each row execute function public.app_guard_consumption();

create trigger consumption_items_10_immutable before update or delete on public.consumption_items
for each row execute function public.app_block_immutable();
create trigger financial_movements_10_immutable before update or delete on public.financial_movements
for each row execute function public.app_block_immutable();
create trigger payment_applications_10_immutable before update or delete on public.payment_applications
for each row execute function public.app_block_immutable();
create trigger inventory_movements_10_immutable before update or delete on public.inventory_movements
for each row execute function public.app_block_immutable();
create trigger fifo_allocations_10_immutable before update or delete on public.fifo_cost_allocations
for each row execute function public.app_block_immutable();
create trigger audit_log_10_immutable before update or delete on public.audit_log
for each row execute function public.app_guard_audit_log();

create trigger accounts_90_audit after insert or update or delete on public.accounts
for each row execute function public.app_write_audit();
create trigger app_users_90_audit after insert or update or delete on public.app_users
for each row execute function public.app_write_audit();
create trigger app_sessions_90_audit after insert or update or delete on public.app_sessions
for each row execute function public.app_write_audit();
create trigger products_90_audit after insert or update or delete on public.products
for each row execute function public.app_write_audit();
create trigger consumptions_90_audit after insert or update or delete on public.consumptions
for each row execute function public.app_write_audit();
create trigger consumption_items_90_audit after insert or update or delete on public.consumption_items
for each row execute function public.app_write_audit();
create trigger financial_movements_90_audit after insert or update or delete on public.financial_movements
for each row execute function public.app_write_audit();
create trigger payment_applications_90_audit after insert or update or delete on public.payment_applications
for each row execute function public.app_write_audit();
create trigger inventory_movements_90_audit after insert or update or delete on public.inventory_movements
for each row execute function public.app_write_audit();
create trigger fifo_allocations_90_audit after insert or update or delete on public.fifo_cost_allocations
for each row execute function public.app_write_audit();

create view public.product_stock
with (security_invoker = true)
as
with allocations as (
  select
    source_movement_id,
    coalesce(sum(quantity), 0)::numeric(14,3) as allocated_quantity
  from public.fifo_cost_allocations
  group by source_movement_id
),
layers as (
  select
    m.product_id,
    greatest(m.quantity_delta - coalesce(a.allocated_quantity, 0), 0)::numeric(14,3) as remaining_quantity,
    m.unit_cost
  from public.inventory_movements m
  left join allocations a on a.source_movement_id = m.id
  where m.quantity_delta > 0
    and m.movement_type in ('purchase', 'adjustment')
),
movement_totals as (
  select product_id, coalesce(sum(quantity_delta), 0)::numeric(14,3) as stock_quantity
  from public.inventory_movements
  group by product_id
)
select
  p.id as product_id,
  p.name as product_name,
  coalesce(mt.stock_quantity, 0)::numeric(14,3) as stock_quantity,
  p.stock_min,
  coalesce((
    select m.unit_cost
    from public.inventory_movements m
    where m.product_id = p.id
      and m.quantity_delta > 0
      and m.unit_cost is not null
      and m.movement_type in ('purchase', 'adjustment')
    order by m.created_at desc, m.id desc
    limit 1
  ), 0)::numeric(14,2) as last_cost,
  coalesce(sum(l.remaining_quantity * coalesce(l.unit_cost, 0)), 0)::numeric(14,2) as inventory_value
from public.products p
left join movement_totals mt on mt.product_id = p.id
left join layers l on l.product_id = p.id
group by p.id, p.name, p.stock_min, mt.stock_quantity;

create view public.consumption_costs
with (security_invoker = true)
as
with item_costs as (
  select
    ci.consumption_id,
    ci.id as consumption_item_id,
    ci.quantity,
    coalesce(sum(fa.quantity), 0)::numeric(14,3) as allocated_quantity,
    coalesce(sum(fa.cost_total), 0)::numeric(14,2) as cost_total
  from public.consumption_items ci
  left join public.fifo_cost_allocations fa on fa.consumption_item_id = ci.id
  group by ci.consumption_id, ci.id, ci.quantity
)
select
  c.id as consumption_id,
  case when c.status = 'voided' then 0 else coalesce(sum(ic.cost_total), 0) end::numeric(14,2) as cost_total,
  case
    when c.status = 'voided' then 0
    else coalesce(sum(greatest(ic.quantity - ic.allocated_quantity, 0)), 0)
  end::numeric(14,3) as pending_quantity,
  case
    when c.status = 'voided' then 'final'
    when coalesce(sum(greatest(ic.quantity - ic.allocated_quantity, 0)), 0) > 0 then 'pending_inventory'
    else 'final'
  end as cost_status
from public.consumptions c
left join item_costs ic on ic.consumption_id = c.id
group by c.id, c.status;

create view public.consumption_payment_status
with (security_invoker = true)
as
select
  c.id as consumption_id,
  c.user_id,
  c.account_id,
  case when c.status = 'voided' then 0 else c.total end::numeric(14,2) as total_due,
  case when c.status = 'voided' then 0 else coalesce(sum(pa.amount), 0) end::numeric(14,2) as applied_amount,
  case
    when c.status = 'voided' then 0
    else greatest(c.total - coalesce(sum(pa.amount), 0), 0)
  end::numeric(14,2) as open_amount,
  case
    when c.status = 'voided' then 'voided'
    when coalesce(sum(pa.amount), 0) <= 0 then 'unpaid'
    when coalesce(sum(pa.amount), 0) < c.total then 'partial'
    else 'paid'
  end as payment_status
from public.consumptions c
left join public.payment_applications pa on pa.consumption_id = c.id
group by c.id, c.user_id, c.account_id, c.status, c.total;

create view public.user_balances
with (security_invoker = true)
as
with consumption_totals as (
  select user_id, coalesce(sum(total), 0)::numeric(14,2) as consumed
  from public.consumptions
  where status = 'confirmed'
  group by user_id
),
applied_totals as (
  select user_id, coalesce(sum(amount), 0)::numeric(14,2) as applied
  from public.payment_applications
  group by user_id
),
payment_credits as (
  select
    fm.paid_by_user_id as user_id,
    coalesce(sum(fm.amount - coalesce(pa.applied, 0)), 0)::numeric(14,2) as credit
  from public.financial_movements fm
  left join (
    select financial_movement_id, sum(amount)::numeric(14,2) as applied
    from public.payment_applications
    group by financial_movement_id
  ) pa on pa.financial_movement_id = fm.id
  where fm.movement_type in ('payment', 'payment_reversal')
  group by fm.paid_by_user_id
),
user_adjustments as (
  select user_id, coalesce(sum(amount), 0)::numeric(14,2) as adjustment
  from public.financial_movements
  where movement_type in ('adjustment', 'adjustment_reversal')
    and scope = 'user'
  group by user_id
)
select
  u.id as user_id,
  u.account_id,
  coalesce(c.consumed, 0)::numeric(14,2) as consumed,
  coalesce(a.applied, 0)::numeric(14,2) as paid,
  coalesce(ua.adjustment, 0)::numeric(14,2) as adjustments,
  coalesce(pc.credit, 0)::numeric(14,2) as unapplied_credit,
  (
    coalesce(c.consumed, 0)
    - coalesce(a.applied, 0)
    - coalesce(pc.credit, 0)
    + coalesce(ua.adjustment, 0)
  )::numeric(14,2) as balance
from public.app_users u
left join consumption_totals c on c.user_id = u.id
left join applied_totals a on a.user_id = u.id
left join payment_credits pc on pc.user_id = u.id
left join user_adjustments ua on ua.user_id = u.id;

create view public.account_balances
with (security_invoker = true)
as
with member_balances as (
  select
    account_id,
    coalesce(sum(consumed), 0)::numeric(14,2) as consumed,
    coalesce(sum(paid), 0)::numeric(14,2) as paid,
    coalesce(sum(adjustments), 0)::numeric(14,2) as user_adjustments,
    coalesce(sum(unapplied_credit), 0)::numeric(14,2) as unapplied_credit
  from public.user_balances
  where account_id is not null
  group by account_id
),
account_effects as (
  select account_id, amount
  from public.financial_movements
  where movement_type in ('adjustment', 'adjustment_reversal') and scope = 'account'
  union all
  select from_account_id, -amount
  from public.financial_movements
  where movement_type = 'account_transfer' and scope = 'account' and from_account_id is not null
  union all
  select to_account_id, amount
  from public.financial_movements
  where movement_type = 'account_transfer' and scope = 'account' and to_account_id is not null
),
account_adjustments as (
  select account_id, coalesce(sum(amount), 0)::numeric(14,2) as adjustment
  from account_effects
  group by account_id
)
select
  a.id as account_id,
  coalesce(mb.consumed, 0)::numeric(14,2) as consumed,
  coalesce(mb.paid, 0)::numeric(14,2) as paid,
  (coalesce(mb.user_adjustments, 0) + coalesce(aa.adjustment, 0))::numeric(14,2) as adjustments,
  coalesce(mb.unapplied_credit, 0)::numeric(14,2) as unapplied_credit,
  (
    coalesce(mb.consumed, 0)
    - coalesce(mb.paid, 0)
    - coalesce(mb.unapplied_credit, 0)
    + coalesce(mb.user_adjustments, 0)
    + coalesce(aa.adjustment, 0)
  )::numeric(14,2) as balance
from public.accounts a
left join member_balances mb on mb.account_id = a.id
left join account_adjustments aa on aa.account_id = a.id;

create or replace function public.app_current_user(p_session_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
  v_device_id text;
begin
  if nullif(p_session_token, '') is null then
    raise exception 'Sesion invalida o expirada.';
  end if;

  select u.*
    into v_user
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token_hash = public.app_hash_token(p_session_token)
    and s.expires_at > now()
    and u.status = 'active'
    and (
      u.role = 'admin'
      or u.account_id is null
      or exists (
        select 1
        from public.accounts a
        where a.id = u.account_id
          and a.status = 'active'
      )
    );

  if not found then
    raise exception 'Sesion invalida o expirada.';
  end if;

  select s.device_id
    into v_device_id
  from public.app_sessions s
  where s.token_hash = public.app_hash_token(p_session_token);

  perform public.app_set_context(
    v_user.id,
    v_user.name,
    coalesce(public.app_context_uuid('app.request_id'), gen_random_uuid()),
    v_device_id,
    null
  );

  update public.app_sessions
     set last_seen_at = now()
   where token_hash = public.app_hash_token(p_session_token);

  return v_user;
end;
$$;

create or replace function public.app_require_admin(p_session_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
begin
  v_user := public.app_current_user(p_session_token);
  if v_user.role <> 'admin' then
    raise exception 'Permiso de administrador requerido.';
  end if;
  return v_user;
end;
$$;

create or replace function public.app_user_balance(p_user_id uuid)
returns numeric(14,2)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select balance from public.user_balances where user_id = p_user_id), 0)::numeric(14,2)
$$;

create or replace function public.app_allocate_fifo_target(p_target_movement_id uuid)
returns numeric(14,3)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.inventory_movements%rowtype;
  v_source record;
  v_needed numeric(14,3);
  v_used numeric(14,3);
  v_allocated numeric(14,3) := 0;
  v_actor uuid := public.app_context_uuid('app.actor_user_id');
  v_request uuid := coalesce(public.app_context_uuid('app.request_id'), gen_random_uuid());
begin
  select *
    into v_target
  from public.inventory_movements
  where id = p_target_movement_id
  for update;

  if not found or v_target.quantity_delta >= 0 then
    return 0;
  end if;

  if v_target.consumption_item_id is not null
     and not exists (
       select 1
       from public.consumption_items ci
       join public.consumptions c on c.id = ci.consumption_id
       where ci.id = v_target.consumption_item_id
         and c.status = 'confirmed'
     )
  then
    return 0;
  end if;

  if exists (
    select 1
    from public.inventory_movements r
    where r.reversed_movement_id = v_target.id
  ) then
    return 0;
  end if;

  select greatest(
    abs(v_target.quantity_delta) - coalesce(sum(quantity), 0),
    0
  )::numeric(14,3)
    into v_needed
  from public.fifo_cost_allocations
  where target_movement_id = v_target.id;

  if v_needed <= 0 then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_target.product_id::text, 0));

  for v_source in
    select
      m.id,
      m.unit_cost,
      greatest(m.quantity_delta - coalesce(a.allocated_quantity, 0), 0)::numeric(14,3) as available_quantity
    from public.inventory_movements m
    left join lateral (
      select coalesce(sum(fa.quantity), 0)::numeric(14,3) as allocated_quantity
      from public.fifo_cost_allocations fa
      where fa.source_movement_id = m.id
    ) a on true
    where m.product_id = v_target.product_id
      and m.quantity_delta > 0
      and m.unit_cost is not null
      and m.movement_type in ('purchase', 'adjustment')
    order by m.created_at, m.id
    for update of m
  loop
    exit when v_needed <= 0;
    if v_source.available_quantity <= 0 then
      continue;
    end if;

    v_used := least(v_needed, v_source.available_quantity);

    insert into public.fifo_cost_allocations(
      product_id, consumption_item_id, source_movement_id, target_movement_id,
      quantity, unit_cost, created_by, request_id
    )
    values (
      v_target.product_id,
      v_target.consumption_item_id,
      v_source.id,
      v_target.id,
      v_used,
      v_source.unit_cost,
      v_actor,
      v_request
    );

    v_needed := v_needed - v_used;
    v_allocated := v_allocated + v_used;
  end loop;

  return v_allocated;
end;
$$;

create or replace function public.app_allocate_pending_fifo(p_product_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target record;
  v_updated integer := 0;
begin
  for v_target in
    select m.id
    from public.inventory_movements m
    left join public.consumption_items ci on ci.id = m.consumption_item_id
    left join public.consumptions c on c.id = ci.consumption_id
    where m.quantity_delta < 0
      and (p_product_id is null or m.product_id = p_product_id)
      and (m.consumption_item_id is null or c.status = 'confirmed')
      and not exists (
        select 1
        from public.inventory_movements r
        where r.reversed_movement_id = m.id
      )
      and abs(m.quantity_delta) > coalesce((
        select sum(fa.quantity)
        from public.fifo_cost_allocations fa
        where fa.target_movement_id = m.id
      ), 0)
    order by m.created_at, m.id
  loop
    perform public.app_allocate_fifo_target(v_target.id);
    v_updated := v_updated + 1;
  end loop;

  return v_updated;
end;
$$;

create or replace function public.app_apply_payment(p_financial_movement_id uuid)
returns numeric(14,2)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.financial_movements%rowtype;
  v_open record;
  v_remaining numeric(14,2);
  v_applied numeric(14,2);
  v_total_applied numeric(14,2) := 0;
  v_actor uuid := public.app_context_uuid('app.actor_user_id');
  v_request uuid := coalesce(public.app_context_uuid('app.request_id'), gen_random_uuid());
begin
  select *
    into v_payment
  from public.financial_movements
  where id = p_financial_movement_id
  for update;

  if not found
     or v_payment.movement_type <> 'payment'
     or v_payment.amount <= 0
     or exists (
       select 1 from public.financial_movements r
       where r.reversed_movement_id = v_payment.id
     )
  then
    return 0;
  end if;

  v_remaining := v_payment.amount - coalesce((
    select sum(amount)
    from public.payment_applications
    where financial_movement_id = v_payment.id
  ), 0);

  if v_remaining <= 0 then
    return 0;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(coalesce(v_payment.account_id, v_payment.user_id, v_payment.paid_by_user_id)::text, 1)
  );
  perform pg_advisory_xact_lock(hashtextextended(v_payment.paid_by_user_id::text, 6));

  for v_open in
    select
      c.id,
      c.account_id,
      c.user_id,
      greatest(c.total - coalesce(sum(pa.amount), 0), 0)::numeric(14,2) as open_amount
    from public.consumptions c
    join public.app_users u on u.id = c.user_id
    left join public.payment_applications pa on pa.consumption_id = c.id
    where c.status = 'confirmed'
      and (
        (v_payment.scope = 'user' and c.user_id = v_payment.user_id)
        or
        (v_payment.scope = 'account' and u.account_id = v_payment.account_id)
      )
    group by c.id, c.account_id, c.user_id, c.total, c.created_at
    having greatest(c.total - coalesce(sum(pa.amount), 0), 0) > 0
    order by c.created_at, c.id
  loop
    exit when v_remaining <= 0;
    v_applied := least(v_remaining, v_open.open_amount);

    insert into public.payment_applications(
      financial_movement_id, consumption_id, account_id, user_id,
      amount, created_by, request_id
    )
    values (
      v_payment.id,
      v_open.id,
      v_open.account_id,
      v_open.user_id,
      v_applied,
      v_actor,
      v_request
    );

    v_remaining := v_remaining - v_applied;
    v_total_applied := v_total_applied + v_applied;
  end loop;

  return v_total_applied;
end;
$$;

create or replace function public.app_apply_user_credit_to_consumption(p_consumption_id uuid)
returns numeric(14,2)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_consumption public.consumptions%rowtype;
  v_payment record;
  v_remaining numeric(14,2);
  v_applied numeric(14,2);
  v_total_applied numeric(14,2) := 0;
  v_actor uuid := public.app_context_uuid('app.actor_user_id');
  v_request uuid := coalesce(public.app_context_uuid('app.request_id'), gen_random_uuid());
begin
  select * into v_consumption
  from public.consumptions
  where id = p_consumption_id and status = 'confirmed'
  for update;
  if not found then return 0; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_consumption.user_id::text, 6));
  v_remaining := greatest(v_consumption.total - coalesce((
    select sum(amount) from public.payment_applications where consumption_id = v_consumption.id
  ), 0), 0);

  for v_payment in
    select
      fm.id,
      greatest(fm.amount - coalesce((
        select sum(pa.amount)
        from public.payment_applications pa
        where pa.financial_movement_id = fm.id
      ), 0), 0)::numeric(14,2) as available_credit
    from public.financial_movements fm
    where fm.movement_type = 'payment'
      and fm.paid_by_user_id = v_consumption.user_id
      and not exists (
        select 1 from public.financial_movements reversal
        where reversal.reversed_movement_id = fm.id
      )
      and greatest(fm.amount - coalesce((
        select sum(pa.amount)
        from public.payment_applications pa
        where pa.financial_movement_id = fm.id
      ), 0), 0) > 0
    order by fm.created_at, fm.id
    for update of fm
  loop
    exit when v_remaining <= 0;
    v_applied := least(v_remaining, v_payment.available_credit);
    insert into public.payment_applications(
      financial_movement_id, consumption_id, account_id, user_id,
      amount, created_by, request_id
    ) values (
      v_payment.id, v_consumption.id, v_consumption.account_id, v_consumption.user_id,
      v_applied, v_actor, v_request
    );
    v_remaining := v_remaining - v_applied;
    v_total_applied := v_total_applied + v_applied;
  end loop;

  return v_total_applied;
end;
$$;

create or replace function public.login_pin(
  p_username text,
  p_pin text,
  p_device_id text,
  p_device_mode text default 'shared'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
  v_account public.accounts%rowtype;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_device_mode text := case when p_device_mode = 'personal' then 'personal' else 'shared' end;
  v_expires_at timestamptz :=
    now() + case when p_device_mode = 'personal' then interval '90 days' else interval '12 hours' end;
  v_request uuid := gen_random_uuid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_device_failed_count integer;
  v_username_failed_count integer;
  v_retry_after integer;
begin
  if nullif(trim(coalesce(p_device_id, '')), '') is null then
    raise exception 'Identificador de dispositivo requerido.';
  end if;
  if length(trim(p_device_id)) > 200 then
    raise exception 'Identificador de dispositivo invalido.';
  end if;
  if length(v_username) not between 2 and 80 then
    return jsonb_build_object(
      'status', 'error',
      'code', 'INVALID_CREDENTIALS',
      'message', 'El usuario o el PIN no coinciden.'
    );
  end if;

  -- El device_id viene del cliente y puede rotarse. Serializamos y limitamos
  -- tambien por nombre de usuario para impedir el bypass distribuido.
  perform pg_advisory_xact_lock(hashtextextended(v_username, 4));
  select
    count(*) filter (where a.device_id = trim(p_device_id)),
    count(*)
    into v_device_failed_count, v_username_failed_count
  from public.audit_log a
  where a.action = 'login_failed'
    and a.entity_type = 'authentication'
    and a.actor_name = v_username
    and a.created_at >= clock_timestamp() - interval '15 minutes';

  if v_device_failed_count >= 5 or v_username_failed_count >= 20 then
    select greatest(
      1,
      ceil(extract(epoch from (
        min(a.created_at) + interval '15 minutes' - clock_timestamp()
      )))::integer
    )
      into v_retry_after
    from public.audit_log a
    where a.action = 'login_failed'
      and a.entity_type = 'authentication'
      and a.actor_name = v_username
      and (
        v_username_failed_count >= 20
        or a.device_id = trim(p_device_id)
      )
      and a.created_at >= clock_timestamp() - interval '15 minutes';

    return jsonb_build_object(
      'status', 'blocked',
      'code', 'RATE_LIMITED',
      'message', 'Demasiados intentos. Espera antes de volver a intentar.',
      'retryAfterSeconds', coalesce(v_retry_after, 900)
    );
  end if;

  select *
    into v_user
  from public.app_users
  where lower(username) = v_username
    and status = 'active';

  if coalesce(p_pin, '') !~ '^[0-9]{4,8}$'
     or not found
     or extensions.crypt(p_pin, v_user.pin_hash) <> v_user.pin_hash
  then
    insert into public.audit_log(
      request_id, actor_name, action, entity_type, record_id,
      changed_fields, reason, device_id, metadata
    )
    values (
      v_request,
      v_username,
      'login_failed',
      'authentication',
      v_user.id,
      '{}'::text[],
      'Credenciales invalidas',
      trim(p_device_id),
      jsonb_build_object('code', 'INVALID_CREDENTIALS')
    );
    return jsonb_build_object(
      'status', 'error',
      'code', 'INVALID_CREDENTIALS',
      'message', 'El usuario o el PIN no coinciden.'
    );
  end if;
  if v_user.role = 'user'
     and v_user.account_id is not null
     and not exists (
       select 1
       from public.accounts a
       where a.id = v_user.account_id
         and a.status = 'active'
     )
  then
    insert into public.audit_log(
      request_id, actor_user_id, actor_name, action, entity_type, record_id,
      changed_fields, reason, device_id, metadata
    )
    values (
      v_request,
      v_user.id,
      v_user.name,
      'login_rejected',
      'authentication',
      v_user.id,
      '{}'::text[],
      'Cuenta inactiva o no asignada',
      trim(p_device_id),
      jsonb_build_object('code', 'ACCOUNT_INACTIVE')
    );
    return jsonb_build_object(
      'status', 'error',
      'code', 'ACCOUNT_INACTIVE',
      'message', 'La cuenta del usuario no esta activa. Contacta al administrador.'
    );
  end if;

  if v_user.account_id is not null then
    select * into v_account from public.accounts where id = v_user.account_id;
  end if;

  perform public.app_set_context(v_user.id, v_user.name, v_request, p_device_id, 'Inicio de sesion');

  insert into public.app_sessions(token_hash, user_id, device_id, device_mode, expires_at)
  values (public.app_hash_token(v_token), v_user.id, trim(p_device_id), v_device_mode, v_expires_at);

  return jsonb_build_object(
    'token', v_token,
    'role', v_user.role,
    'deviceMode', v_device_mode,
    'userId', v_user.id,
    'userName', v_user.name,
    'accountId', v_user.account_id,
    'accountName', v_account.name,
    'balance', case when v_user.role = 'user' then public.app_user_balance(v_user.id) else null end,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.logout_session(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
  v_device_id text;
  v_request uuid := gen_random_uuid();
begin
  select u.*
    into v_user
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token_hash = public.app_hash_token(p_session_token);
  if not found then
    raise exception 'Sesion invalida o expirada.';
  end if;
  select s.device_id
    into v_device_id
  from public.app_sessions s
  where s.token_hash = public.app_hash_token(p_session_token);

  perform public.app_set_context(
    v_user.id, v_user.name, v_request, v_device_id, 'Cierre de sesion'
  );

  delete from public.app_sessions
  where token_hash = public.app_hash_token(p_session_token);

  if not found then
    raise exception 'Sesion invalida o expirada.';
  end if;

  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.change_my_pin(
  p_session_token text,
  p_current_pin text,
  p_new_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
  v_new_salt text;
  v_request uuid := gen_random_uuid();
  v_device_id text;
begin
  if coalesce(p_new_pin, '') !~ '^[0-9]{4,8}$' then
    raise exception 'El PIN debe tener entre 4 y 8 digitos.';
  end if;

  v_user := public.app_current_user(p_session_token);
  v_device_id := nullif(current_setting('app.device_id', true), '');
  if extensions.crypt(coalesce(p_current_pin, ''), v_user.pin_hash) <> v_user.pin_hash then
    raise exception 'El PIN actual no coincide.';
  end if;

  perform public.app_set_context(v_user.id, v_user.name, v_request, v_device_id, 'Cambio de PIN');
  v_new_salt := extensions.gen_salt('bf');

  update public.app_users
     set pin_salt = v_new_salt,
         pin_hash = extensions.crypt(p_new_pin, v_new_salt)
   where id = v_user.id;

  perform set_config('app.audit_disabled', 'on', true);
  delete from public.app_sessions
   where user_id = v_user.id
     and token_hash <> public.app_hash_token(p_session_token);
  perform set_config('app.audit_disabled', 'off', true);

  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.get_user_catalog(
  p_session_token text,
  p_since_version integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
  v_account public.accounts%rowtype;
  v_catalog_version bigint;
begin
  v_user := public.app_current_user(p_session_token);
  if v_user.role <> 'user' then
    raise exception 'Catalogo disponible solo para usuarios.';
  end if;

  if v_user.account_id is not null then
    select * into v_account from public.accounts where id = v_user.account_id;
  end if;

  select coalesce(max(version), 0) into v_catalog_version from public.products;

  return jsonb_build_object(
    'catalogVersion', v_catalog_version,
    'user', jsonb_build_object('id', v_user.id, 'name', v_user.name),
    'account', jsonb_build_object('id', v_account.id, 'name', v_account.name),
    'balance', public.app_user_balance(v_user.id),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'category', p.category,
          'price', p.price,
          'imageUrl', p.image_url,
          'imageSourceUrl', p.image_source_url,
          'imageCredit', p.image_credit,
          'status', p.status,
          'version', p.version,
          'updatedAt', p.updated_at
        )
        order by p.name, p.id
      )
      from public.products p
      where p.version > greatest(coalesce(p_since_version, 0), 0)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_consumption(
  p_session_token text,
  p_client_operation_id text,
  p_device_id text,
  p_catalog_version integer,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
  v_existing public.consumptions%rowtype;
  v_client_operation_id uuid;
  v_request uuid;
  v_consumption_id uuid := gen_random_uuid();
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity numeric(14,3);
  v_total numeric(14,2) := 0;
  v_catalog_version bigint;
  v_catalog_was_stale boolean := false;
  v_item_id uuid;
  v_target_movement_id uuid;
  v_session_device_id text;
begin
  v_user := public.app_current_user(p_session_token);
  v_session_device_id := coalesce(nullif(current_setting('app.device_id', true), ''), 'unknown');
  if v_user.role <> 'user' then
    raise exception 'Solo usuarios pueden registrar compras desde catalogo.';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'La lista de productos es invalida.';
  end if;
  if nullif(trim(coalesce(p_client_operation_id, '')), '') is null then
    raise exception 'client_operation_id requerido.';
  end if;
  if jsonb_array_length(p_items) <> (
    select count(distinct value->>'productId')
    from jsonb_array_elements(p_items)
  ) then
    raise exception 'Un producto no puede repetirse en la misma compra.';
  end if;

  v_client_operation_id := public.app_uuid(trim(p_client_operation_id));
  v_request := v_client_operation_id;
  perform pg_advisory_xact_lock(hashtextextended(v_client_operation_id::text, 2));

  select *
    into v_existing
  from public.consumptions
  where client_operation_id = v_client_operation_id;

  if found then
    if v_existing.user_id <> v_user.id then
      raise exception 'client_operation_id ya pertenece a otro usuario.';
    end if;
    return jsonb_build_object(
      'status', 'confirmed',
      'consumptionId', v_existing.id,
      'total', v_existing.total,
      'message', 'Compra ya habia sido confirmada.'
    );
  end if;

  select coalesce(max(version), 0) into v_catalog_version from public.products;
  if greatest(coalesce(p_catalog_version, 0), 0) < v_catalog_version then
    v_catalog_was_stale := true;
  end if;

  -- Primera pasada: validar todo y fijar el total antes de insertar el encabezado inmutable.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_quantity := round((v_item->>'quantity')::numeric, 3);
    exception when others then
      raise exception 'Cantidad invalida para el producto %.', coalesce(v_item->>'productId', '(sin id)');
    end;

    if v_quantity <= 0 then
      raise exception 'Todas las cantidades deben ser mayores que cero.';
    end if;

    select *
      into v_product
    from public.products
    where id = public.app_uuid(v_item->>'productId')
      and status = 'active';

    if not found then
      raise exception 'Producto no disponible: %', coalesce(v_item->>'productId', '(sin id)');
    end if;

    v_total := v_total + round(v_product.price * v_quantity, 2);
  end loop;

  if v_total <= 0 then
    raise exception 'El carrito esta vacio.';
  end if;

  perform public.app_set_context(
    v_user.id,
    v_user.name,
    v_request,
    v_session_device_id,
    'Registro de compra'
  );

  insert into public.consumptions(
    id, client_operation_id, account_id, user_id, device_id, catalog_version,
    total, request_id
  )
  values (
    v_consumption_id, v_client_operation_id, v_user.account_id, v_user.id,
    v_session_device_id,
    greatest(coalesce(p_catalog_version, 0), 0),
    v_total, v_request
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := round((v_item->>'quantity')::numeric, 3);

    select *
      into v_product
    from public.products
    where id = public.app_uuid(v_item->>'productId')
      and status = 'active';

    perform pg_advisory_xact_lock(hashtextextended(v_product.id::text, 0));

    insert into public.consumption_items(
      consumption_id, account_id, user_id, product_id, product_name,
      quantity, unit_price
    )
    values (
      v_consumption_id, v_user.account_id, v_user.id, v_product.id, v_product.name,
      v_quantity, v_product.price
    )
    returning id into v_item_id;

    insert into public.inventory_movements(
      product_id, movement_type, quantity_delta, consumption_item_id,
      note, created_by, request_id
    )
    values (
      v_product.id, 'consumption', -v_quantity, v_item_id,
      'Consumo ' || v_consumption_id::text, v_user.id, v_request
    )
    returning id into v_target_movement_id;

    perform public.app_allocate_fifo_target(v_target_movement_id);
  end loop;

  perform public.app_apply_user_credit_to_consumption(v_consumption_id);

  return jsonb_build_object(
    'status', 'confirmed',
    'consumptionId', v_consumption_id,
    'total', v_total,
    'catalogWasStale', v_catalog_was_stale,
    'message', case
      when v_catalog_was_stale then 'Compra confirmada con el precio oficial vigente; el catalogo local estaba desactualizado.'
      else 'Compra confirmada.'
    end
  );
end;
$$;

create or replace function public.admin_get_snapshot(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.app_users%rowtype;
begin
  v_admin := public.app_require_admin(p_session_token);

  return jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'status', a.status,
        'archivedAt', a.archived_at,
        'archivedBy', a.archived_by,
        'archiveReason', a.archive_reason,
        'createdAt', a.created_at,
        'updatedAt', a.updated_at,
        'version', a.version
      ) order by a.name, a.id)
      from public.accounts a
    ), '[]'::jsonb),

    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'accountId', u.account_id,
        'username', u.username,
        'name', u.name,
        'role', u.role,
        'status', u.status,
        'archivedAt', u.archived_at,
        'archivedBy', u.archived_by,
        'archiveReason', u.archive_reason,
        'createdAt', u.created_at,
        'updatedAt', u.updated_at,
        'version', u.version
      ) order by u.name, u.id)
      from public.app_users u
    ), '[]'::jsonb),

    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'category', p.category,
        'price', p.price,
        'stockMin', p.stock_min,
        'lastCost', ps.last_cost,
        'imageUrl', p.image_url,
        'imageSourceUrl', p.image_source_url,
        'imageCredit', p.image_credit,
        'status', p.status,
        'archivedAt', p.archived_at,
        'archivedBy', p.archived_by,
        'archiveReason', p.archive_reason,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at,
        'version', p.version
      ) order by p.name, p.id)
      from public.products p
      join public.product_stock ps on ps.product_id = p.id
    ), '[]'::jsonb),

    'consumptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'clientOperationId', c.client_operation_id,
        'accountId', c.account_id,
        'userId', c.user_id,
        'deviceId', c.device_id,
        'catalogVersion', c.catalog_version,
        'status', c.status,
        'total', c.total,
        'costTotal', cc.cost_total,
        'costStatus', cc.cost_status,
        'createdAt', c.created_at,
        'voidedAt', c.voided_at,
        'voidedBy', c.voided_by,
        'voidReason', c.void_reason
      ) order by c.created_at desc, c.id desc)
      from public.consumptions c
      join public.consumption_costs cc on cc.consumption_id = c.id
    ), '[]'::jsonb),

    'consumptionItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ci.id,
        'consumptionId', ci.consumption_id,
        'accountId', ci.account_id,
        'userId', ci.user_id,
        'productId', ci.product_id,
        'productName', ci.product_name,
        'quantity', ci.quantity,
        'unitPrice', ci.unit_price,
        'total', ci.total,
        'unitCost', case
          when c.status = 'voided' then 0
          when ci.quantity > 0 then coalesce(alloc.cost_total, 0) / ci.quantity
          else 0
        end,
        'costTotal', case when c.status = 'voided' then 0 else coalesce(alloc.cost_total, 0) end,
        'pendingCostQuantity', case
          when c.status = 'voided' then 0
          else greatest(ci.quantity - coalesce(alloc.allocated_quantity, 0), 0)
        end,
        'costStatus', case
          when c.status = 'voided' then 'final'
          when greatest(ci.quantity - coalesce(alloc.allocated_quantity, 0), 0) > 0
            then 'pending_inventory'
          else 'final'
        end,
        'createdAt', ci.created_at
      ) order by ci.created_at desc, ci.id desc)
      from public.consumption_items ci
      join public.consumptions c on c.id = ci.consumption_id
      left join lateral (
        select
          coalesce(sum(fa.quantity), 0)::numeric(14,3) as allocated_quantity,
          coalesce(sum(fa.cost_total), 0)::numeric(14,2) as cost_total
        from public.fifo_cost_allocations fa
        where fa.consumption_item_id = ci.id
      ) alloc on true
    ), '[]'::jsonb),

    'financialMovements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fm.id,
        'movementType', fm.movement_type,
        'accountId', fm.account_id,
        'scope', fm.scope,
        'userId', fm.user_id,
        'paidByUserId', fm.paid_by_user_id,
        'amount', fm.amount,
        'unappliedAmount', case
          when fm.movement_type in ('payment', 'payment_reversal')
            then fm.amount - coalesce(ap.applied_amount, 0)
          else 0
        end,
        'fromAccountId', fm.from_account_id,
        'toAccountId', fm.to_account_id,
        'reversedMovementId', fm.reversed_movement_id,
        'note', fm.note,
        'createdBy', fm.created_by,
        'requestId', fm.request_id,
        'createdAt', fm.created_at
      ) order by fm.created_at desc, fm.id desc)
      from public.financial_movements fm
      left join lateral (
        select coalesce(sum(pa.amount), 0)::numeric(14,2) as applied_amount
        from public.payment_applications pa
        where pa.financial_movement_id = fm.id
      ) ap on true
    ), '[]'::jsonb),

    'paymentApplications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pa.id,
        'financialMovementId', pa.financial_movement_id,
        'paymentId', pa.financial_movement_id,
        'consumptionId', pa.consumption_id,
        'accountId', pa.account_id,
        'userId', pa.user_id,
        'amount', pa.amount,
        'reversedApplicationId', pa.reversed_application_id,
        'createdBy', pa.created_by,
        'requestId', pa.request_id,
        'createdAt', pa.created_at
      ) order by pa.created_at desc, pa.id desc)
      from public.payment_applications pa
    ), '[]'::jsonb),

    'inventoryMovements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', im.id,
        'productId', im.product_id,
        'movementType', im.movement_type,
        'type', im.movement_type,
        'quantityDelta', im.quantity_delta,
        'unitCost', im.unit_cost,
        'consumptionItemId', im.consumption_item_id,
        'referenceId', coalesce(im.consumption_item_id, im.reversed_movement_id),
        'reversedMovementId', im.reversed_movement_id,
        'note', im.note,
        'createdBy', im.created_by,
        'requestId', im.request_id,
        'createdAt', im.created_at
      ) order by im.created_at desc, im.id desc)
      from public.inventory_movements im
    ), '[]'::jsonb),

    'fifoCostAllocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fa.id,
        'productId', fa.product_id,
        'consumptionItemId', fa.consumption_item_id,
        'sourceMovementId', fa.source_movement_id,
        'targetMovementId', fa.target_movement_id,
        'quantity', fa.quantity,
        'unitCost', fa.unit_cost,
        'costTotal', fa.cost_total,
        'reversedAllocationId', fa.reversed_allocation_id,
        'createdAt', fa.created_at
      ) order by fa.created_at desc, fa.id desc)
      from public.fifo_cost_allocations fa
    ), '[]'::jsonb),

    'productStock', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', ps.product_id,
        'productName', ps.product_name,
        'stockQuantity', ps.stock_quantity,
        'stockMin', ps.stock_min,
        'lastCost', ps.last_cost,
        'inventoryValue', ps.inventory_value
      ) order by ps.product_name, ps.product_id)
      from public.product_stock ps
    ), '[]'::jsonb),

    'consumptionCosts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'consumptionId', cc.consumption_id,
        'costTotal', cc.cost_total,
        'pendingQuantity', cc.pending_quantity,
        'costStatus', cc.cost_status
      ) order by cc.consumption_id)
      from public.consumption_costs cc
    ), '[]'::jsonb),

    'userBalances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', ub.user_id,
        'accountId', ub.account_id,
        'consumed', ub.consumed,
        'paid', ub.paid,
        'adjustments', ub.adjustments,
        'unappliedCredit', ub.unapplied_credit,
        'balance', ub.balance
      ) order by ub.user_id)
      from public.user_balances ub
    ), '[]'::jsonb),

    'accountBalances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'accountId', ab.account_id,
        'consumed', ab.consumed,
        'paid', ab.paid,
        'adjustments', ab.adjustments,
        'unappliedCredit', ab.unapplied_credit,
        'balance', ab.balance
      ) order by ab.account_id)
      from public.account_balances ab
    ), '[]'::jsonb),

    'consumptionPaymentStatus', coalesce((
      select jsonb_agg(jsonb_build_object(
        'consumptionId', cps.consumption_id,
        'userId', cps.user_id,
        'accountId', cps.account_id,
        'totalDue', cps.total_due,
        'appliedAmount', cps.applied_amount,
        'openAmount', cps.open_amount,
        'paymentStatus', cps.payment_status
      ) order by cps.consumption_id)
      from public.consumption_payment_status cps
    ), '[]'::jsonb),

    -- Alias de lectura para clientes v1. No existen tablas legacy.
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fm.id,
        'accountId', fm.account_id,
        'targetType', fm.scope,
        'userId', fm.user_id,
        'paidByUserId', fm.paid_by_user_id,
        'amount', fm.amount,
        'unappliedAmount', fm.amount - coalesce(ap.applied_amount, 0),
        'note', fm.note,
        'createdAt', fm.created_at
      ) order by fm.created_at desc, fm.id desc)
      from public.financial_movements fm
      left join lateral (
        select coalesce(sum(pa.amount), 0)::numeric(14,2) as applied_amount
        from public.payment_applications pa
        where pa.financial_movement_id = fm.id
      ) ap on true
      where fm.movement_type = 'payment'
    ), '[]'::jsonb),

    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', im.id,
        'productId', im.product_id,
        'quantity', im.quantity_delta,
        'unitCost', im.unit_cost,
        'totalCost', round(im.quantity_delta * im.unit_cost, 2),
        'note', im.note,
        'createdAt', im.created_at
      ) order by im.created_at desc, im.id desc)
      from public.inventory_movements im
      where im.movement_type = 'purchase'
    ), '[]'::jsonb),

    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fm.id,
        'accountId', fm.account_id,
        'scope', fm.scope,
        'userId', fm.user_id,
        'amount', fm.amount,
        'note', fm.note,
        'createdAt', fm.created_at
      ) order by fm.created_at desc, fm.id desc)
      from public.financial_movements fm
      where fm.movement_type in ('adjustment', 'adjustment_reversal')
    ), '[]'::jsonb),

    'accountTransfers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fm.id,
        'userId', fm.user_id,
        'fromAccountId', fm.from_account_id,
        'toAccountId', fm.to_account_id,
        'movedBalance', fm.amount,
        'note', fm.note,
        'createdAt', fm.created_at
      ) order by fm.created_at desc, fm.id desc)
      from public.financial_movements fm
      where fm.movement_type = 'account_transfer'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_command(
  p_session_token text,
  p_idempotency_key text,
  p_command text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.app_users%rowtype;
  v_existing public.audit_log%rowtype;
  v_response jsonb := '{}'::jsonb;
  v_request uuid;
  v_reason text;
  v_id uuid;
  v_account_id uuid;
  v_user_id uuid;
  v_product_id uuid;
  v_new_account_id uuid;
  v_financial_id uuid;
  v_inventory_id uuid;
  v_original_financial public.financial_movements%rowtype;
  v_original_inventory public.inventory_movements%rowtype;
  v_consumption public.consumptions%rowtype;
  v_user public.app_users%rowtype;
  v_product public.products%rowtype;
  v_salt text;
  v_username text;
  v_scope text;
  v_amount numeric(14,2);
  v_quantity numeric(14,3);
  v_unit_cost numeric(14,2);
  v_balance numeric(14,2);
  v_account_adjustment_balance numeric(14,2);
  v_device_id text;
  v_expected_version integer;
  v_row record;
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key requerido.';
  end if;
  if nullif(trim(coalesce(p_command, '')), '') is null then
    raise exception 'Comando administrativo requerido.';
  end if;

  v_admin := public.app_require_admin(p_session_token);
  v_device_id := nullif(current_setting('app.device_id', true), '');
  v_request := public.app_uuid(trim(p_idempotency_key));
  v_reason := coalesce(
    nullif(trim(coalesce(p_payload->>'reason', '')), ''),
    nullif(trim(coalesce(p_payload->>'note', '')), ''),
    p_command
  );

  perform pg_advisory_xact_lock(hashtextextended(trim(p_idempotency_key), 3));
  perform public.app_set_context(v_admin.id, v_admin.name, v_request, v_device_id, v_reason);

  select *
    into v_existing
  from public.audit_log
  where action = 'command'
    and idempotency_key = trim(p_idempotency_key);

  if found then
    if v_existing.metadata->>'command' is distinct from p_command
       or v_existing.after_data is distinct from public.app_redact_json(coalesce(p_payload, '{}'::jsonb))
    then
      raise exception 'La clave de idempotencia ya fue usada con otra operacion.';
    end if;
    return coalesce(v_existing.metadata->'response', '{}'::jsonb);
  end if;

  insert into public.audit_log(
    request_id, idempotency_key, actor_user_id, actor_name, action,
    entity_type, record_id, after_data, changed_fields, reason, device_id, metadata
  )
  values (
    v_request,
    trim(p_idempotency_key),
    v_admin.id,
    v_admin.name,
    'command',
    'admin_command',
    v_request,
    public.app_redact_json(coalesce(p_payload, '{}'::jsonb)),
    array[p_command],
    v_reason,
    v_device_id,
    jsonb_build_object('command', p_command)
  );

  if p_command = 'create_account' then
    insert into public.accounts(name)
    values (trim(p_payload->>'name'))
    returning id into v_id;

    if p_payload ? 'userIds' then
      if jsonb_typeof(p_payload->'userIds') <> 'array' then
        raise exception 'userIds debe ser un arreglo.';
      end if;
      if jsonb_array_length(p_payload->'userIds') <> (
        select count(distinct public.app_uuid(value))
        from jsonb_array_elements_text(p_payload->'userIds')
      ) then
        raise exception 'userIds contiene usuarios repetidos.';
      end if;

      for v_row in
        select public.app_uuid(value) as user_id
        from jsonb_array_elements_text(p_payload->'userIds')
        order by public.app_uuid(value)
      loop
        select *
          into v_user
        from public.app_users
        where id = v_row.user_id
          and role = 'user'
          and status = 'active'
          and account_id is null
        for update;
        if not found then
          raise exception 'El usuario % no existe, esta archivado o ya pertenece a una cuenta.', v_row.user_id;
        end if;

        v_balance := public.app_user_balance(v_user.id);
        update public.app_users set account_id = v_id where id = v_user.id;
        insert into public.financial_movements(
          movement_type, account_id, scope, user_id, amount,
          from_account_id, to_account_id, note, created_by, request_id
        )
        values (
          'account_transfer', v_id, 'user', v_user.id, v_balance,
          null, v_id, 'Asignacion durante alta de cuenta', v_admin.id, v_request
        );
      end loop;
    end if;

    v_response := jsonb_build_object(
      'id', v_id,
      'assignedUserIds', coalesce(p_payload->'userIds', '[]'::jsonb)
    );

  elsif p_command = 'update_account' then
    update public.accounts
       set name = coalesce(nullif(trim(p_payload->>'name'), ''), name)
     where id = public.app_uuid(p_payload->>'id')
       and version = coalesce((p_payload->>'version')::integer, version);
    if not found then
      raise exception 'Cuenta desactualizada. Refresca antes de guardar.';
    end if;
    v_response := jsonb_build_object('id', public.app_uuid(p_payload->>'id'));

  elsif p_command = 'archive_account' then
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo de archivo es obligatorio.';
    end if;
    perform 1
    from public.accounts
    where id = public.app_uuid(p_payload->>'id')
      and status = 'active'
    for update;
    if not found then
      raise exception 'Cuenta no encontrada o ya archivada.';
    end if;
    if exists (
      select 1
      from public.app_users u
      where u.account_id = public.app_uuid(p_payload->>'id')
        and u.status = 'active'
    ) then
      raise exception 'La cuenta tiene usuarios activos. Muevelos o archivalos antes de archivar la cuenta.';
    end if;
    update public.accounts
       set status = 'inactive', archive_reason = v_reason
     where id = public.app_uuid(p_payload->>'id')
       and status = 'active';
    if not found then
      raise exception 'Cuenta no encontrada o ya archivada.';
    end if;
    v_response := jsonb_build_object('id', public.app_uuid(p_payload->>'id'), 'status', 'inactive');

  elsif p_command = 'restore_account' then
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo de restauracion es obligatorio.';
    end if;
    update public.accounts
       set status = 'active'
     where id = public.app_uuid(p_payload->>'id')
       and status = 'inactive';
    if not found then
      raise exception 'Cuenta no encontrada o ya activa.';
    end if;
    v_response := jsonb_build_object('id', public.app_uuid(p_payload->>'id'), 'status', 'active');

  elsif p_command = 'create_user' then
    if coalesce(p_payload->>'pin', '') !~ '^[0-9]{4,8}$' then
      raise exception 'El PIN debe tener entre 4 y 8 digitos.';
    end if;
    v_username := lower(coalesce(
      nullif(trim(p_payload->>'username'), ''),
      regexp_replace(trim(p_payload->>'name'), '\s+', '_', 'g')
    ));
    v_account_id := case
      when nullif(p_payload->>'accountId', '') is null then null
      else public.app_uuid(p_payload->>'accountId')
    end;
    if v_account_id is not null then
      perform 1
      from public.accounts
      where id = v_account_id and status = 'active'
      for share;
      if not found then
        raise exception 'La cuenta seleccionada no existe o esta archivada.';
      end if;
    end if;
    v_salt := extensions.gen_salt('bf');

    insert into public.app_users(
      account_id, username, name, role, pin_salt, pin_hash
    )
    values (
      v_account_id,
      v_username,
      trim(p_payload->>'name'),
      case when p_payload->>'role' = 'admin' then 'admin' else 'user' end,
      v_salt,
      extensions.crypt(p_payload->>'pin', v_salt)
    )
    returning id into v_id;

    v_response := jsonb_build_object('id', v_id);

  elsif p_command = 'update_user' then
    if nullif(p_payload->>'newPin', '') is not null
       and p_payload->>'newPin' !~ '^[0-9]{4,8}$'
    then
      raise exception 'El PIN debe tener entre 4 y 8 digitos.';
    end if;

    if nullif(p_payload->>'newPin', '') is not null then
      v_salt := extensions.gen_salt('bf');
    end if;

    update public.app_users
       set name = coalesce(nullif(trim(p_payload->>'name'), ''), name),
           username = coalesce(nullif(lower(trim(p_payload->>'username')), ''), username),
           role = case
             when p_payload->>'role' in ('admin', 'user') then p_payload->>'role'
             else role
           end,
           pin_salt = case when v_salt is not null then v_salt else pin_salt end,
           pin_hash = case
             when v_salt is not null then extensions.crypt(p_payload->>'newPin', v_salt)
             else pin_hash
           end
     where id = public.app_uuid(p_payload->>'id')
       and version = coalesce((p_payload->>'version')::integer, version);

    if not found then
      raise exception 'Usuario desactualizado. Refresca antes de guardar.';
    end if;

    if v_salt is not null then
      perform set_config('app.audit_disabled', 'on', true);
      delete from public.app_sessions where user_id = public.app_uuid(p_payload->>'id');
      perform set_config('app.audit_disabled', 'off', true);
    end if;

    v_response := jsonb_build_object('id', public.app_uuid(p_payload->>'id'));

  elsif p_command = 'archive_user' then
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo de archivo es obligatorio.';
    end if;
    update public.app_users
       set status = 'inactive', archive_reason = v_reason
     where id = public.app_uuid(p_payload->>'id')
       and status = 'active'
       and id <> v_admin.id;
    if not found then
      raise exception 'Usuario no encontrado, ya archivado o corresponde a tu sesion.';
    end if;
    delete from public.app_sessions
    where user_id = public.app_uuid(p_payload->>'id');
    v_response := jsonb_build_object('id', public.app_uuid(p_payload->>'id'), 'status', 'inactive');

  elsif p_command = 'restore_user' then
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo de restauracion es obligatorio.';
    end if;
    select *
      into v_user
    from public.app_users
    where id = public.app_uuid(p_payload->>'id')
      and status = 'inactive'
    for update;
    if not found then
      raise exception 'Usuario no encontrado o ya activo.';
    end if;
    if v_user.role <> 'admin' and v_user.account_id is not null then
      perform 1
      from public.accounts
      where id = v_user.account_id
        and status = 'active'
      for share;
      if not found then
        raise exception 'La cuenta del usuario esta archivada. Restaurala o mueve el usuario antes.';
      end if;
    end if;
    update public.app_users
       set status = 'active'
     where id = v_user.id;
    v_response := jsonb_build_object('id', public.app_uuid(p_payload->>'id'), 'status', 'active');

  elsif p_command in (
    'assign_user_to_account', 'remove_user_from_account', 'independize_user'
  ) then
    if nullif(coalesce(p_payload->>'expectedVersion', p_payload->>'version'), '') is null then
      raise exception 'expectedVersion del usuario es obligatorio.';
    end if;
    v_expected_version := coalesce(
      (p_payload->>'expectedVersion')::integer,
      (p_payload->>'version')::integer
    );
    v_user_id := public.app_uuid(p_payload->>'userId');
    select * into v_user from public.app_users where id = v_user_id for update;
    if not found then
      raise exception 'Usuario no encontrado.';
    end if;
    if v_user.role <> 'user' then
      raise exception 'Solo los usuarios comerciales pueden pertenecer a una cuenta.';
    end if;
    if v_user.version <> v_expected_version then
      raise exception 'Usuario desactualizado. Refresca antes de moverlo.';
    end if;

    v_account_id := v_user.account_id;
    v_new_account_id := null;

    if p_command = 'assign_user_to_account' then
      v_new_account_id := public.app_uuid(p_payload->>'accountId');
      perform 1
      from public.accounts
      where id = v_new_account_id and status = 'active'
      for share;
      if not found then
        raise exception 'Cuenta destino no encontrada o archivada.';
      end if;
    elsif p_command = 'independize_user'
          and nullif(trim(coalesce(p_payload->>'newAccountName', '')), '') is not null
    then
      insert into public.accounts(name)
      values (trim(p_payload->>'newAccountName'))
      returning id into v_new_account_id;
    end if;

    if v_account_id is not distinct from v_new_account_id then
      raise exception 'El usuario ya pertenece a esa cuenta.';
    end if;

    v_balance := public.app_user_balance(v_user_id);
    update public.app_users set account_id = v_new_account_id where id = v_user_id;

    insert into public.financial_movements(
      movement_type, account_id, scope, user_id, amount,
      from_account_id, to_account_id, note, created_by, request_id
    )
    values (
      'account_transfer', v_new_account_id, 'user', v_user_id, v_balance,
      v_account_id, v_new_account_id,
      case
        when p_command = 'independize_user' then 'Independizacion de usuario'
        when p_command = 'remove_user_from_account' then 'Usuario retirado de cuenta'
        else 'Usuario asignado a cuenta'
      end,
      v_admin.id, v_request
    )
    returning id into v_id;

    v_response := jsonb_build_object('id', v_id, 'userId', v_user_id, 'accountId', v_new_account_id);

  elsif p_command = 'merge_accounts' then
    v_account_id := public.app_uuid(p_payload->>'sourceAccountId');
    v_new_account_id := public.app_uuid(p_payload->>'targetAccountId');
    if v_account_id = v_new_account_id then
      raise exception 'Las cuentas origen y destino deben ser distintas.';
    end if;
    perform 1
    from public.accounts
    where id in (v_account_id, v_new_account_id)
    order by id
    for update;
    if not exists (
      select 1 from public.accounts where id = v_new_account_id and status = 'active'
    ) then
      raise exception 'Cuenta destino no encontrada o archivada.';
    end if;

    select coalesce(sum(effect), 0)::numeric(14,2)
      into v_account_adjustment_balance
    from (
      select amount as effect
      from public.financial_movements
      where movement_type in ('adjustment', 'adjustment_reversal')
        and scope = 'account' and account_id = v_account_id
      union all
      select -amount
      from public.financial_movements
      where movement_type = 'account_transfer'
        and scope = 'account' and from_account_id = v_account_id
      union all
      select amount
      from public.financial_movements
      where movement_type = 'account_transfer'
        and scope = 'account' and to_account_id = v_account_id
    ) account_effects;

    for v_row in
      select * from public.app_users where account_id = v_account_id order by id for update
    loop
      v_balance := public.app_user_balance(v_row.id);
      update public.app_users set account_id = v_new_account_id where id = v_row.id;
      insert into public.financial_movements(
        movement_type, account_id, scope, user_id, amount,
        from_account_id, to_account_id, note, created_by, request_id
      )
      values (
        'account_transfer', v_new_account_id, 'user', v_row.id, v_balance,
        v_account_id, v_new_account_id, 'Union de cuentas', v_admin.id, v_request
      );
    end loop;

    if v_account_adjustment_balance <> 0 then
      insert into public.financial_movements(
        movement_type, account_id, scope, amount,
        from_account_id, to_account_id, note, created_by, request_id
      )
      values (
        'account_transfer', v_new_account_id, 'account', v_account_adjustment_balance,
        v_account_id, v_new_account_id, 'Traslado de saldo global por union de cuentas', v_admin.id, v_request
      );
    end if;

    update public.accounts
       set status = 'inactive', archive_reason = coalesce(v_reason, 'Cuenta fusionada')
     where id = v_account_id
       and status = 'active';
    if not found then
      raise exception 'Cuenta origen no encontrada o ya archivada.';
    end if;
    v_response := jsonb_build_object('sourceAccountId', v_account_id, 'targetAccountId', v_new_account_id);

  elsif p_command = 'create_product' then
    insert into public.products(
      name, category, price, stock_min, image_url, image_source_url, image_credit
    )
    values (
      trim(p_payload->>'name'),
      coalesce(nullif(trim(p_payload->>'category'), ''), 'General'),
      round(coalesce((p_payload->>'price')::numeric, 0), 2),
      round(coalesce((p_payload->>'stockMin')::numeric, 0), 3),
      nullif(trim(coalesce(p_payload->>'imageUrl', '')), ''),
      nullif(trim(coalesce(p_payload->>'imageSourceUrl', '')), ''),
      nullif(trim(coalesce(p_payload->>'imageCredit', '')), '')
    )
    returning id into v_id;
    v_response := jsonb_build_object('id', v_id);

  elsif p_command = 'update_product' then
    update public.products
       set name = coalesce(nullif(trim(p_payload->>'name'), ''), name),
           category = coalesce(nullif(trim(p_payload->>'category'), ''), category),
           price = coalesce(round((p_payload->>'price')::numeric, 2), price),
           stock_min = coalesce(round((p_payload->>'stockMin')::numeric, 3), stock_min),
           image_url = case
             when p_payload ? 'imageUrl' then nullif(trim(coalesce(p_payload->>'imageUrl', '')), '')
             else image_url
           end,
           image_source_url = case
             when p_payload ? 'imageSourceUrl' then nullif(trim(coalesce(p_payload->>'imageSourceUrl', '')), '')
             else image_source_url
           end,
           image_credit = case
             when p_payload ? 'imageCredit' then nullif(trim(coalesce(p_payload->>'imageCredit', '')), '')
             else image_credit
           end
     where id = public.app_uuid(p_payload->>'id')
       and version = coalesce((p_payload->>'version')::bigint, version);
    if not found then
      raise exception 'Producto desactualizado. Refresca antes de guardar.';
    end if;
    v_response := jsonb_build_object('id', public.app_uuid(p_payload->>'id'));

  elsif p_command = 'archive_product' then
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo de archivo es obligatorio.';
    end if;
    update public.products
       set status = 'inactive', archive_reason = v_reason
     where id = public.app_uuid(p_payload->>'id')
       and status = 'active';
    if not found then
      raise exception 'Producto no encontrado o ya archivado.';
    end if;
    v_response := jsonb_build_object('id', public.app_uuid(p_payload->>'id'), 'status', 'inactive');

  elsif p_command = 'restore_product' then
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo de restauracion es obligatorio.';
    end if;
    update public.products
       set status = 'active'
     where id = public.app_uuid(p_payload->>'id')
       and status = 'inactive';
    if not found then
      raise exception 'Producto no encontrado o ya activo.';
    end if;
    v_response := jsonb_build_object('id', public.app_uuid(p_payload->>'id'), 'status', 'active');

  elsif p_command = 'bulk_products' then
    v_scope := p_payload->>'mode';
    if v_scope not in ('purchase', 'inventory', 'prices') then
      raise exception 'Modo de operación masiva no soportado.';
    end if;
    if jsonb_typeof(p_payload->'items') is distinct from 'array'
       or coalesce(jsonb_array_length(p_payload->'items'), 0) = 0
    then
      raise exception 'La operación masiva requiere al menos un producto.';
    end if;
    if jsonb_array_length(p_payload->'items') <> (
      select count(distinct value->>'productId') from jsonb_array_elements(p_payload->'items')
    ) then
      raise exception 'La operación masiva contiene productos repetidos o sin identificador.';
    end if;

    for v_item in
      select value from jsonb_array_elements(p_payload->'items') order by value->>'productId'
    loop
      v_product_id := public.app_uuid(v_item->>'productId');
      select * into v_product from public.products where id = v_product_id for update;
      if not found then raise exception 'Producto no encontrado: %.', v_item->>'productId'; end if;

      if v_scope = 'prices' then
        v_amount := round((v_item->>'price')::numeric, 2);
        if v_amount < 0 then raise exception 'Precio inválido para %.', v_product.name; end if;
        if nullif(v_item->>'version', '') is null or v_product.version <> (v_item->>'version')::bigint then
          raise exception 'Producto % desactualizado. Refresca antes de guardar.', v_product.name;
        end if;
        update public.products set price = v_amount where id = v_product_id;
        v_results := v_results || jsonb_build_array(jsonb_build_object('productId', v_product_id));

      elsif v_scope = 'purchase' then
        v_quantity := round((v_item->>'quantity')::numeric, 3);
        v_unit_cost := round((v_item->>'unitCost')::numeric, 2);
        if v_quantity <= 0 or v_unit_cost < 0 then
          raise exception 'Cantidad o costo inválido para %.', v_product.name;
        end if;
        perform pg_advisory_xact_lock(hashtextextended(v_product_id::text, 0));
        insert into public.inventory_movements(
          product_id, movement_type, quantity_delta, unit_cost, note, created_by, request_id
        ) values (
          v_product_id, 'purchase', v_quantity, v_unit_cost,
          nullif(trim(coalesce(v_item->>'note', '')), ''), v_admin.id, v_request
        ) returning id into v_inventory_id;
        perform public.app_allocate_pending_fifo(v_product_id);
        v_results := v_results || jsonb_build_array(jsonb_build_object('productId', v_product_id, 'id', v_inventory_id));

      else
        v_quantity := round((v_item->>'quantityDelta')::numeric, 3);
        if v_quantity = 0 then raise exception 'El ajuste de % no cambia el inventario.', v_product.name; end if;
        if nullif(trim(coalesce(v_item->>'note', '')), '') is null then
          raise exception 'El motivo del ajuste de % es obligatorio.', v_product.name;
        end if;
        perform pg_advisory_xact_lock(hashtextextended(v_product_id::text, 0));
        if v_quantity > 0 then
          v_unit_cost := coalesce(
            (v_item->>'unitCost')::numeric,
            (select last_cost from public.product_stock where product_id = v_product_id),
            0
          );
          if v_unit_cost < 0 then raise exception 'El costo del ajuste de % no puede ser negativo.', v_product.name; end if;
        else
          v_unit_cost := null;
        end if;
        insert into public.inventory_movements(
          product_id, movement_type, quantity_delta, unit_cost, note, created_by, request_id
        ) values (
          v_product_id, 'adjustment', v_quantity, v_unit_cost,
          trim(v_item->>'note'), v_admin.id, v_request
        ) returning id into v_inventory_id;
        if v_quantity < 0 then
          perform public.app_allocate_fifo_target(v_inventory_id);
        else
          perform public.app_allocate_pending_fifo(v_product_id);
        end if;
        v_results := v_results || jsonb_build_array(jsonb_build_object('productId', v_product_id, 'id', v_inventory_id));
      end if;
    end loop;
    v_response := jsonb_build_object('count', jsonb_array_length(v_results), 'items', v_results);

  elsif p_command = 'create_purchase' then
    v_product_id := public.app_uuid(p_payload->>'productId');
    v_quantity := round((p_payload->>'quantity')::numeric, 3);
    v_unit_cost := round((p_payload->>'unitCost')::numeric, 2);
    if v_quantity <= 0 or v_unit_cost < 0 then
      raise exception 'Cantidad y costo de compra invalidos.';
    end if;

    select * into v_product from public.products where id = v_product_id for update;
    if not found then
      raise exception 'Producto no encontrado.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_product_id::text, 0));

    insert into public.inventory_movements(
      product_id, movement_type, quantity_delta, unit_cost,
      note, created_by, request_id
    )
    values (
      v_product_id, 'purchase', v_quantity, v_unit_cost,
      nullif(trim(coalesce(p_payload->>'note', '')), ''),
      v_admin.id, v_request
    )
    returning id into v_id;

    perform public.app_allocate_pending_fifo(v_product_id);
    v_response := jsonb_build_object('id', v_id);

  elsif p_command = 'adjust_inventory' then
    v_product_id := public.app_uuid(p_payload->>'productId');
    v_quantity := round((p_payload->>'quantityDelta')::numeric, 3);
    if v_quantity = 0 then
      raise exception 'El ajuste de inventario no puede ser cero.';
    end if;
    if nullif(trim(coalesce(p_payload->>'note', '')), '') is null then
      raise exception 'El motivo del ajuste es obligatorio.';
    end if;

    select * into v_product from public.products where id = v_product_id for update;
    if not found then
      raise exception 'Producto no encontrado.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_product_id::text, 0));

    if v_quantity > 0 then
      v_unit_cost := coalesce(
        (p_payload->>'unitCost')::numeric,
        (select last_cost from public.product_stock where product_id = v_product_id),
        0
      );
      if v_unit_cost < 0 then
        raise exception 'El costo del ajuste no puede ser negativo.';
      end if;
    else
      v_unit_cost := null;
    end if;

    insert into public.inventory_movements(
      product_id, movement_type, quantity_delta, unit_cost,
      note, created_by, request_id
    )
    values (
      v_product_id, 'adjustment', v_quantity, v_unit_cost,
      trim(p_payload->>'note'), v_admin.id, v_request
    )
    returning id into v_inventory_id;

    if v_quantity < 0 then
      perform public.app_allocate_fifo_target(v_inventory_id);
    else
      perform public.app_allocate_pending_fifo(v_product_id);
    end if;
    v_response := jsonb_build_object('id', v_inventory_id);

  elsif p_command in ('reverse_inventory_movement', 'reverse_purchase', 'reverse_inventory_adjustment') then
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo de reversion es obligatorio.';
    end if;
    v_inventory_id := public.app_uuid(coalesce(
      p_payload->>'movementId',
      p_payload->>'inventoryMovementId',
      p_payload->>'purchaseId'
    ));
    select *
      into v_original_inventory
    from public.inventory_movements
    where id = v_inventory_id
      and movement_type in ('purchase', 'adjustment')
    for update;
    if not found then
      raise exception 'Movimiento de inventario no encontrado o no reversible por este comando.';
    end if;
    if exists (
      select 1 from public.inventory_movements where reversed_movement_id = v_original_inventory.id
    ) then
      raise exception 'El movimiento de inventario ya fue revertido.';
    end if;
    if v_original_inventory.quantity_delta > 0
       and coalesce((
         select sum(fa.quantity)
         from public.fifo_cost_allocations fa
         where fa.source_movement_id = v_original_inventory.id
       ), 0) <> 0
    then
      raise exception 'La entrada ya financio salidas de inventario. Anule primero esas operaciones.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_original_inventory.product_id::text, 0));
    insert into public.inventory_movements(
      product_id, movement_type, quantity_delta, unit_cost, reversed_movement_id,
      note, created_by, request_id
    )
    values (
      v_original_inventory.product_id,
      'adjustment_reversal',
      -v_original_inventory.quantity_delta,
      case when -v_original_inventory.quantity_delta > 0 then v_original_inventory.unit_cost else null end,
      v_original_inventory.id,
      coalesce(nullif(trim(p_payload->>'reason'), ''), 'Reversion de movimiento de inventario'),
      v_admin.id,
      v_request
    )
    returning id into v_id;

    if v_original_inventory.quantity_delta < 0 then
      for v_row in
        select fa.*
        from public.fifo_cost_allocations fa
        where fa.target_movement_id = v_original_inventory.id
          and fa.quantity > 0
          and not exists (
            select 1 from public.fifo_cost_allocations r
            where r.reversed_allocation_id = fa.id
          )
        order by fa.created_at, fa.id
      loop
        insert into public.fifo_cost_allocations(
          product_id, consumption_item_id, source_movement_id, target_movement_id,
          quantity, unit_cost, reversed_allocation_id, created_by, request_id
        )
        values (
          v_row.product_id, null, v_row.source_movement_id, v_id,
          -v_row.quantity, v_row.unit_cost, v_row.id, v_admin.id, v_request
        );
      end loop;
      perform public.app_allocate_pending_fifo(v_original_inventory.product_id);
    else
      -- La salida inversa consume exactamente la capa que se esta corrigiendo.
      insert into public.fifo_cost_allocations(
        product_id, consumption_item_id, source_movement_id, target_movement_id,
        quantity, unit_cost, created_by, request_id
      )
      values (
        v_original_inventory.product_id,
        null,
        v_original_inventory.id,
        v_id,
        v_original_inventory.quantity_delta,
        v_original_inventory.unit_cost,
        v_admin.id,
        v_request
      );
    end if;
    v_response := jsonb_build_object('id', v_id, 'reversedMovementId', v_original_inventory.id);

  elsif p_command = 'create_payment' then
    v_scope := case when p_payload->>'targetType' = 'user' then 'user' else 'account' end;
    v_amount := round((p_payload->>'amount')::numeric, 2);
    if v_amount <= 0 then
      raise exception 'El pago debe ser mayor que cero.';
    end if;

    v_account_id := case
      when nullif(p_payload->>'accountId', '') is null then null
      else public.app_uuid(p_payload->>'accountId')
    end;
    v_user_id := case
      when nullif(p_payload->>'userId', '') is null then null
      else public.app_uuid(p_payload->>'userId')
    end;
    if v_scope = 'user' then
      if v_user_id is null then
        raise exception 'El pago individual requiere un usuario destino.';
      end if;
      select account_id
        into v_new_account_id
      from public.app_users
      where id = v_user_id
        and status = 'active';
      if not found then
        raise exception 'Usuario destino no encontrado o archivado.';
      end if;
      if v_account_id is not null and v_account_id is distinct from v_new_account_id then
        raise exception 'La cuenta enviada no coincide con la cuenta actual del usuario.';
      end if;
      v_account_id := v_new_account_id;
    end if;

    select *
      into v_user
    from public.app_users
    where id = case
      when nullif(p_payload->>'paidByUserId', '') is not null
        then public.app_uuid(p_payload->>'paidByUserId')
      else v_user_id
    end
      and status = 'active';
    if not found then
      raise exception 'Selecciona el usuario que realiza el pago.';
    end if;
    if v_scope = 'user' and v_user.account_id is distinct from v_account_id then
      raise exception 'El usuario pagador debe pertenecer a la misma cuenta del usuario destino.';
    end if;
    if v_scope = 'account' and (v_account_id is null or v_user.account_id is distinct from v_account_id) then
      raise exception 'El usuario pagador debe pertenecer a la cuenta destino.';
    end if;

    insert into public.financial_movements(
      movement_type, account_id, scope, user_id, paid_by_user_id,
      amount, note, created_by, request_id
    )
    values (
      'payment', v_account_id, v_scope, v_user_id, v_user.id,
      v_amount, nullif(trim(coalesce(p_payload->>'note', '')), ''), v_admin.id, v_request
    )
    returning id into v_financial_id;

    perform public.app_apply_payment(v_financial_id);
    v_response := jsonb_build_object('id', v_financial_id);

  elsif p_command = 'create_adjustment' then
    v_scope := case when p_payload->>'scope' = 'user' then 'user' else 'account' end;
    v_amount := round((p_payload->>'amount')::numeric, 2);
    if v_amount = 0 then
      raise exception 'El ajuste financiero no puede ser cero.';
    end if;
    if nullif(trim(coalesce(p_payload->>'note', '')), '') is null then
      raise exception 'El motivo del ajuste es obligatorio.';
    end if;

    v_account_id := case
      when nullif(p_payload->>'accountId', '') is null then null
      else public.app_uuid(p_payload->>'accountId')
    end;
    v_user_id := case
      when nullif(p_payload->>'userId', '') is null then null
      else public.app_uuid(p_payload->>'userId')
    end;
    if v_scope = 'user' and v_user_id is null then
      raise exception 'El ajuste individual requiere usuario.';
    end if;
    if v_scope = 'account' and v_account_id is null then
      raise exception 'El ajuste de cuenta requiere cuenta.';
    end if;
    if v_scope = 'user' then
      select * into v_user
      from public.app_users
      where id = v_user_id and role = 'user' and status = 'active'
      for share;
      if not found then
        raise exception 'Usuario no encontrado, archivado o no comercial.';
      end if;
      v_account_id := v_user.account_id;
    else
      perform 1 from public.accounts
      where id = v_account_id and status = 'active'
      for share;
      if not found then
        raise exception 'Cuenta no encontrada o archivada.';
      end if;
    end if;

    insert into public.financial_movements(
      movement_type, account_id, scope, user_id, amount,
      note, created_by, request_id
    )
    values (
      'adjustment', v_account_id, v_scope, v_user_id, v_amount,
      trim(p_payload->>'note'), v_admin.id, v_request
    )
    returning id into v_id;
    v_response := jsonb_build_object('id', v_id);

  elsif p_command in ('reverse_financial_movement', 'reverse_payment', 'reverse_adjustment') then
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo de reversion es obligatorio.';
    end if;
    v_financial_id := public.app_uuid(coalesce(
      p_payload->>'movementId',
      p_payload->>'financialMovementId',
      p_payload->>'paymentId',
      p_payload->>'adjustmentId'
    ));
    select *
      into v_original_financial
    from public.financial_movements
    where id = v_financial_id
      and movement_type in ('payment', 'adjustment')
    for update;
    if not found then
      raise exception 'Movimiento financiero no encontrado o no reversible.';
    end if;
    if exists (
      select 1 from public.financial_movements where reversed_movement_id = v_original_financial.id
    ) then
      raise exception 'El movimiento financiero ya fue revertido.';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended(
        coalesce(
          v_original_financial.account_id,
          v_original_financial.user_id,
          v_original_financial.paid_by_user_id
        )::text,
        1
      )
    );
    perform pg_advisory_xact_lock(hashtextextended(v_original_financial.paid_by_user_id::text, 6));

    insert into public.financial_movements(
      movement_type, account_id, scope, user_id, paid_by_user_id,
      amount, from_account_id, to_account_id, reversed_movement_id,
      note, created_by, request_id
    )
    values (
      case
        when v_original_financial.movement_type = 'payment' then 'payment_reversal'
        else 'adjustment_reversal'
      end,
      v_original_financial.account_id,
      v_original_financial.scope,
      v_original_financial.user_id,
      v_original_financial.paid_by_user_id,
      -v_original_financial.amount,
      v_original_financial.from_account_id,
      v_original_financial.to_account_id,
      v_original_financial.id,
      coalesce(nullif(trim(p_payload->>'reason'), ''), 'Reversion de movimiento financiero'),
      v_admin.id,
      v_request
    )
    returning id into v_id;

    if v_original_financial.movement_type = 'payment' then
      for v_row in
        select pa.*
        from public.payment_applications pa
        where pa.financial_movement_id = v_original_financial.id
          and pa.amount > 0
          and not exists (
            select 1 from public.payment_applications r
            where r.reversed_application_id = pa.id
          )
        order by pa.created_at, pa.id
      loop
        insert into public.payment_applications(
          financial_movement_id, consumption_id, account_id, user_id,
          amount, reversed_application_id, created_by, request_id
        )
        values (
          v_id, v_row.consumption_id, v_row.account_id, v_row.user_id,
          -v_row.amount, v_row.id, v_admin.id, v_request
        );
      end loop;
    end if;
    v_response := jsonb_build_object('id', v_id, 'reversedMovementId', v_original_financial.id);

  elsif p_command = 'void_consumption' then
    select *
      into v_consumption
    from public.consumptions
    where id = public.app_uuid(p_payload->>'consumptionId')
      and status = 'confirmed'
    for update;
    if not found then
      raise exception 'Consumo no encontrado o ya anulado.';
    end if;
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo de anulacion es obligatorio.';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended(coalesce(v_consumption.account_id, v_consumption.user_id)::text, 1)
    );

    update public.consumptions
       set status = 'voided',
           voided_at = now(),
           voided_by = v_admin.id,
           void_reason = trim(p_payload->>'reason')
     where id = v_consumption.id;

    for v_row in
      select im.*
      from public.inventory_movements im
      join public.consumption_items ci on ci.id = im.consumption_item_id
      where ci.consumption_id = v_consumption.id
        and im.movement_type = 'consumption'
      order by im.created_at, im.id
    loop
      insert into public.inventory_movements(
        product_id, movement_type, quantity_delta, unit_cost,
        consumption_item_id, reversed_movement_id, note, created_by, request_id
      )
      values (
        v_row.product_id, 'void_consumption', -v_row.quantity_delta, null,
        v_row.consumption_item_id, v_row.id, trim(p_payload->>'reason'),
        v_admin.id, v_request
      )
      returning id into v_inventory_id;

      insert into public.fifo_cost_allocations(
        product_id, consumption_item_id, source_movement_id, target_movement_id,
        quantity, unit_cost, reversed_allocation_id, created_by, request_id
      )
      select
        fa.product_id,
        fa.consumption_item_id,
        fa.source_movement_id,
        v_inventory_id,
        -fa.quantity,
        fa.unit_cost,
        fa.id,
        v_admin.id,
        v_request
      from public.fifo_cost_allocations fa
      where fa.target_movement_id = v_row.id
        and fa.quantity > 0
        and not exists (
          select 1 from public.fifo_cost_allocations r
          where r.reversed_allocation_id = fa.id
        );

      perform public.app_allocate_pending_fifo(v_row.product_id);
    end loop;

    insert into public.payment_applications(
      financial_movement_id, consumption_id, account_id, user_id,
      amount, reversed_application_id, created_by, request_id
    )
    select
      pa.financial_movement_id,
      pa.consumption_id,
      pa.account_id,
      pa.user_id,
      -pa.amount,
      pa.id,
      v_admin.id,
      v_request
    from public.payment_applications pa
    where pa.consumption_id = v_consumption.id
      and pa.amount > 0
      and not exists (
        select 1 from public.payment_applications r
        where r.reversed_application_id = pa.id
      );

    for v_row in
      select distinct pa.financial_movement_id
      from public.payment_applications pa
      where pa.request_id = v_request
        and pa.reversed_application_id is not null
    loop
      perform public.app_apply_payment(v_row.financial_movement_id);
    end loop;

    v_response := jsonb_build_object('id', v_consumption.id, 'status', 'voided');

  elsif p_command = 'recalculate_fifo' then
    v_response := jsonb_build_object(
      'updatedItems',
      public.app_allocate_pending_fifo(
        case
          when nullif(p_payload->>'productId', '') is null then null
          else public.app_uuid(p_payload->>'productId')
        end
      ),
      'mode',
      'incremental'
    );

  else
    raise exception 'Comando admin no soportado: %', p_command;
  end if;

  update public.audit_log
     set metadata = jsonb_set(metadata, '{response}', v_response, true)
   where action = 'command'
     and idempotency_key = trim(p_idempotency_key);

  return v_response;
end;
$$;

create or replace function public.admin_get_audit_log(
  p_session_token text,
  p_page integer default 1,
  p_page_size integer default 50,
  p_entity_type text default null,
  p_action text default null,
  p_actor_user_id text default null,
  p_search text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.app_users%rowtype;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_total bigint;
  v_items jsonb;
begin
  v_admin := public.app_require_admin(p_session_token);

  select count(*)
    into v_total
  from public.audit_log a
  where (nullif(trim(p_entity_type), '') is null or a.entity_type = trim(p_entity_type))
    and (nullif(trim(p_action), '') is null or a.action = trim(p_action))
    and (nullif(trim(p_actor_user_id), '') is null or a.actor_user_id::text = trim(p_actor_user_id))
    and (
      nullif(trim(p_search), '') is null
      or position(lower(trim(p_search)) in lower(concat_ws(
        ' ', a.actor_name, a.action, a.entity_type, a.record_id::text,
        a.reason, array_to_string(a.changed_fields, ' ')
      ))) > 0
    )
    and (p_date_from is null or a.created_at >= p_date_from)
    and (p_date_to is null or a.created_at < p_date_to);

  select coalesce(jsonb_agg(entry order by created_at desc, id desc), '[]'::jsonb)
    into v_items
  from (
    select
      a.id,
      a.created_at,
      jsonb_build_object(
        'id', a.id,
        'requestId', a.request_id,
        'idempotencyKey', a.idempotency_key,
        'actorUserId', a.actor_user_id,
        'actorName', a.actor_name,
        'action', a.action,
        'entityType', a.entity_type,
        'recordId', a.record_id,
        'beforeData', a.before_data,
        'afterData', a.after_data,
        'changedFields', to_jsonb(a.changed_fields),
        'reason', a.reason,
        'deviceId', a.device_id,
        'metadata', a.metadata,
        'createdAt', a.created_at
      ) as entry
    from public.audit_log a
    where (nullif(trim(p_entity_type), '') is null or a.entity_type = trim(p_entity_type))
      and (nullif(trim(p_action), '') is null or a.action = trim(p_action))
      and (nullif(trim(p_actor_user_id), '') is null or a.actor_user_id::text = trim(p_actor_user_id))
      and (
        nullif(trim(p_search), '') is null
        or position(lower(trim(p_search)) in lower(concat_ws(
          ' ', a.actor_name, a.action, a.entity_type, a.record_id::text,
          a.reason, array_to_string(a.changed_fields, ' ')
        ))) > 0
      )
      and (p_date_from is null or a.created_at >= p_date_from)
      and (p_date_to is null or a.created_at < p_date_to)
    order by a.created_at desc, a.id desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  ) page_rows;

  return jsonb_build_object(
    'items', v_items,
    'page', v_page,
    'pageSize', v_page_size,
    'total', v_total
  );
end;
$$;

alter table public.accounts enable row level security;
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.products enable row level security;
alter table public.consumptions enable row level security;
alter table public.consumption_items enable row level security;
alter table public.financial_movements enable row level security;
alter table public.payment_applications enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.fifo_cost_allocations enable row level security;
alter table public.audit_log enable row level security;

revoke all on table public.accounts from public, anon, authenticated;
revoke all on table public.app_users from public, anon, authenticated;
revoke all on table public.app_sessions from public, anon, authenticated;
revoke all on table public.products from public, anon, authenticated;
revoke all on table public.consumptions from public, anon, authenticated;
revoke all on table public.consumption_items from public, anon, authenticated;
revoke all on table public.financial_movements from public, anon, authenticated;
revoke all on table public.payment_applications from public, anon, authenticated;
revoke all on table public.inventory_movements from public, anon, authenticated;
revoke all on table public.fifo_cost_allocations from public, anon, authenticated;
revoke all on table public.audit_log from public, anon, authenticated;
revoke all on table public.product_stock from public, anon, authenticated;
revoke all on table public.consumption_costs from public, anon, authenticated;
revoke all on table public.user_balances from public, anon, authenticated;
revoke all on table public.account_balances from public, anon, authenticated;
revoke all on table public.consumption_payment_status from public, anon, authenticated;
revoke all on sequence public.catalog_version_seq from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function public.login_pin(text, text, text, text) to anon, authenticated;
grant execute on function public.logout_session(text) to anon, authenticated;
grant execute on function public.change_my_pin(text, text, text) to anon, authenticated;
grant execute on function public.get_user_catalog(text, integer) to anon, authenticated;
grant execute on function public.create_consumption(text, text, text, integer, jsonb) to anon, authenticated;
grant execute on function public.admin_get_snapshot(text) to anon, authenticated;
grant execute on function public.admin_command(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.admin_get_audit_log(
  text, integer, integer, text, text, text, text, timestamptz, timestamptz
) to anon, authenticated;
commit;
