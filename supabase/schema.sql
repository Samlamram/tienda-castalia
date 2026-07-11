create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id text primary key default ('acct_' || gen_random_uuid()::text),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.app_users (
  id text primary key default ('usr_' || gen_random_uuid()::text),
  account_id text references public.accounts(id),
  username text not null unique,
  name text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  pin_salt text not null,
  pin_hash text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.app_sessions (
  token_hash text primary key,
  user_id text not null references public.app_users(id),
  device_id text not null,
  device_mode text not null default 'shared' check (device_mode in ('personal', 'shared')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.app_sessions
  add column if not exists device_mode text not null default 'shared' check (device_mode in ('personal', 'shared'));

create table if not exists public.products (
  id text primary key default ('prd_' || gen_random_uuid()::text),
  name text not null,
  category text not null default 'General',
  price numeric not null default 0,
  stock_min numeric not null default 0,
  last_cost numeric not null default 0,
  image_url text,
  image_source_url text,
  image_credit text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.consumptions (
  id text primary key default ('con_' || gen_random_uuid()::text),
  client_operation_id text unique,
  account_id text not null references public.accounts(id),
  user_id text not null references public.app_users(id),
  status text not null default 'confirmed' check (status in ('confirmed', 'voided')),
  total numeric not null default 0,
  cost_total numeric not null default 0,
  cost_status text not null default 'pending_recalc' check (cost_status in ('final', 'pending_recalc')),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);

create table if not exists public.consumption_items (
  id text primary key default ('item_' || gen_random_uuid()::text),
  consumption_id text not null references public.consumptions(id),
  account_id text not null references public.accounts(id),
  user_id text not null references public.app_users(id),
  product_id text not null references public.products(id),
  product_name text not null,
  quantity numeric not null,
  unit_price numeric not null,
  total numeric not null,
  unit_cost numeric not null default 0,
  cost_total numeric not null default 0,
  pending_cost_quantity numeric not null default 0,
  cost_status text not null default 'pending_recalc' check (cost_status in ('final', 'pending_recalc')),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id text primary key default ('pay_' || gen_random_uuid()::text),
  account_id text not null references public.accounts(id),
  target_type text not null check (target_type in ('account', 'user')),
  user_id text references public.app_users(id),
  amount numeric not null,
  unapplied_amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_applications (
  id text primary key default ('app_' || gen_random_uuid()::text),
  payment_id text not null references public.payments(id),
  account_id text not null references public.accounts(id),
  user_id text not null references public.app_users(id),
  consumption_item_id text not null references public.consumption_items(id),
  amount numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id text primary key default ('pur_' || gen_random_uuid()::text),
  product_id text not null references public.products(id),
  quantity numeric not null,
  unit_cost numeric not null,
  total_cost numeric not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id text primary key default ('mov_' || gen_random_uuid()::text),
  product_id text not null references public.products(id),
  type text not null check (type in ('purchase', 'consumption', 'void_consumption', 'adjustment', 'cost_recalc')),
  quantity_delta numeric not null,
  unit_cost numeric,
  reference_id text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.adjustments (
  id text primary key default ('adj_' || gen_random_uuid()::text),
  account_id text not null references public.accounts(id),
  scope text not null check (scope in ('account', 'user')),
  user_id text references public.app_users(id),
  amount numeric not null,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.account_transfers (
  id text primary key default ('trf_' || gen_random_uuid()::text),
  user_id text not null references public.app_users(id),
  from_account_id text not null references public.accounts(id),
  to_account_id text not null references public.accounts(id),
  moved_balance numeric not null default 0,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fifo_cost_allocations (
  id text primary key default ('fifo_' || gen_random_uuid()::text),
  product_id text not null references public.products(id),
  consumption_item_id text not null references public.consumption_items(id),
  source_movement_id text not null references public.inventory_movements(id),
  quantity numeric not null,
  unit_cost numeric not null,
  cost_total numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id text primary key default ('audit_' || gen_random_uuid()::text),
  admin_user_id text not null references public.app_users(id),
  idempotency_key text not null unique,
  command text not null,
  payload jsonb not null,
  response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_operations (
  id text primary key,
  entity text not null,
  entity_id text not null,
  action text not null check (action in ('upsert', 'delete')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists app_sessions_user_idx on public.app_sessions (user_id, expires_at);
create index if not exists products_version_idx on public.products (version, updated_at);
create index if not exists consumptions_account_idx on public.consumptions (account_id, user_id, created_at);
create index if not exists consumption_items_product_idx on public.consumption_items (product_id, created_at);
create index if not exists payment_applications_item_idx on public.payment_applications (consumption_item_id);
create index if not exists inventory_movements_product_idx on public.inventory_movements (product_id, created_at);
create index if not exists sync_operations_created_at_idx on public.sync_operations (created_at);
create index if not exists sync_operations_entity_idx on public.sync_operations (entity, entity_id);

create or replace function public.app_hash_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.app_current_user(p_session_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select u.*
    into v_user
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token_hash = public.app_hash_token(p_session_token)
    and s.expires_at > now()
    and u.status = 'active';

  if not found then
    raise exception 'Sesion invalida o expirada.';
  end if;

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
set search_path = public
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

create or replace function public.app_user_balance(p_user_id text)
returns numeric
language sql
stable
as $$
  with consumed as (
    select coalesce(sum(ci.total), 0) as value
    from public.consumption_items ci
    join public.consumptions c on c.id = ci.consumption_id
    where ci.user_id = p_user_id and c.status = 'confirmed'
  ),
  applied as (
    select coalesce(sum(amount), 0) as value
    from public.payment_applications
    where user_id = p_user_id
  ),
  unapplied as (
    select coalesce(sum(unapplied_amount), 0) as value
    from public.payments
    where target_type = 'user' and user_id = p_user_id
  ),
  adjustments_total as (
    select coalesce(sum(amount), 0) as value
    from public.adjustments
    where scope = 'user' and user_id = p_user_id
  )
  select consumed.value - applied.value - unapplied.value + adjustments_total.value
  from consumed, applied, unapplied, adjustments_total
$$;

drop function if exists public.login_pin(text, text, text);

create or replace function public.login_pin(p_username text, p_pin text, p_device_id text, p_device_mode text default 'shared')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_account public.accounts%rowtype;
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_device_mode text := case when p_device_mode = 'personal' then 'personal' else 'shared' end;
  v_expires_at timestamptz := now() + case when p_device_mode = 'personal' then interval '90 days' else interval '12 hours' end;
begin
  select *
    into v_user
  from public.app_users
  where lower(username) = lower(trim(p_username))
    and status = 'active';

  if not found or crypt(p_pin, v_user.pin_hash) <> v_user.pin_hash then
    raise exception 'El usuario o el PIN no coinciden.';
  end if;

  if v_user.account_id is not null then
    select * into v_account from public.accounts where id = v_user.account_id;
  end if;

  insert into public.app_sessions(token_hash, user_id, device_id, device_mode, expires_at)
  values (public.app_hash_token(v_token), v_user.id, coalesce(p_device_id, 'unknown'), v_device_mode, v_expires_at);

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

create or replace function public.change_my_pin(p_session_token text, p_current_pin text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_new_salt text;
begin
  if coalesce(p_new_pin, '') !~ '^[0-9]{4,8}$' then
    raise exception 'El PIN debe tener entre 4 y 8 digitos.';
  end if;

  v_user := public.app_current_user(p_session_token);

  if crypt(p_current_pin, v_user.pin_hash) <> v_user.pin_hash then
    raise exception 'El PIN actual no coincide.';
  end if;

  v_new_salt := gen_salt('bf');

  update public.app_users
     set pin_salt = v_new_salt,
         pin_hash = crypt(p_new_pin, v_new_salt),
         updated_at = now(),
         version = version + 1
   where id = v_user.id;

  delete from public.app_sessions
   where user_id = v_user.id
     and token_hash <> public.app_hash_token(p_session_token);

  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.get_user_catalog(p_session_token text, p_since_version integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_account public.accounts%rowtype;
  v_catalog_version integer;
begin
  v_user := public.app_current_user(p_session_token);
  if v_user.role <> 'user' then
    raise exception 'Catalogo disponible solo para usuarios.';
  end if;

  select * into v_account from public.accounts where id = v_user.account_id;
  select coalesce(max(version), 0) into v_catalog_version from public.products;

  return jsonb_build_object(
    'catalogVersion', v_catalog_version,
    'user', jsonb_build_object('id', v_user.id, 'name', v_user.name),
    'account', jsonb_build_object('id', v_account.id, 'name', v_account.name),
    'balance', public.app_user_balance(v_user.id),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
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
      ) order by p.name)
      from public.products p
      where p.version > coalesce(p_since_version, 0)
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
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_consumption_id text;
  v_existing public.consumptions%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity numeric;
  v_total numeric := 0;
  v_catalog_version integer;
  v_status text := 'confirmed';
begin
  v_user := public.app_current_user(p_session_token);
  if v_user.role <> 'user' then
    raise exception 'Solo usuarios pueden registrar compras desde catalogo.';
  end if;
  if v_user.account_id is null then
    raise exception 'Usuario sin cuenta asociada.';
  end if;

  select * into v_existing
  from public.consumptions
  where client_operation_id = p_client_operation_id;

  if found then
    return jsonb_build_object(
      'status', 'confirmed',
      'consumptionId', v_existing.id,
      'message', 'Compra ya habia sido confirmada.'
    );
  end if;

  select coalesce(max(version), 0) into v_catalog_version from public.products;
  if coalesce(p_catalog_version, 0) < v_catalog_version then
    v_status := 'needs_review';
  end if;

  v_consumption_id := 'con_' || gen_random_uuid()::text;
  insert into public.consumptions(id, client_operation_id, account_id, user_id, status, total, cost_total, cost_status)
  values (v_consumption_id, p_client_operation_id, v_user.account_id, v_user.id, 'confirmed', 0, 0, 'pending_recalc');

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_quantity := greatest(0, coalesce((v_item->>'quantity')::numeric, 0));
    if v_quantity <= 0 then
      continue;
    end if;

    select * into v_product
    from public.products
    where id = v_item->>'productId'
      and status = 'active';

    if not found then
      raise exception 'Producto no disponible: %', v_item->>'productId';
    end if;

    insert into public.consumption_items(
      consumption_id, account_id, user_id, product_id, product_name, quantity, unit_price, total,
      unit_cost, cost_total, pending_cost_quantity, cost_status
    )
    values (
      v_consumption_id, v_user.account_id, v_user.id, v_product.id, v_product.name, v_quantity,
      v_product.price, v_product.price * v_quantity, 0, 0, v_quantity, 'pending_recalc'
    );

    insert into public.inventory_movements(product_id, type, quantity_delta, unit_cost, reference_id, note)
    values (v_product.id, 'consumption', -v_quantity, null, v_consumption_id, p_device_id);

    v_total := v_total + (v_product.price * v_quantity);
  end loop;

  if v_total <= 0 then
    raise exception 'El carrito esta vacio.';
  end if;

  update public.consumptions
     set total = v_total
   where id = v_consumption_id;

  return jsonb_build_object(
    'status', v_status,
    'consumptionId', v_consumption_id,
    'message', case when v_status = 'needs_review' then 'Compra confirmada con catalogo desactualizado.' else 'Compra confirmada.' end
  );
end;
$$;

create or replace function public.admin_get_snapshot(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.app_users%rowtype;
begin
  v_admin := public.app_require_admin(p_session_token);

  return jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'status', status, 'createdAt', created_at, 'updatedAt', updated_at, 'version', version
    ) order by name) from public.accounts), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'accountId', account_id, 'username', username, 'name', name, 'role', role, 'status', status,
      'createdAt', created_at, 'updatedAt', updated_at, 'version', version
    ) order by name) from public.app_users), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'category', category, 'price', price, 'stockMin', stock_min, 'lastCost', last_cost,
      'imageUrl', image_url, 'imageSourceUrl', image_source_url, 'imageCredit', image_credit, 'status', status,
      'createdAt', created_at, 'updatedAt', updated_at, 'version', version
    ) order by name) from public.products), '[]'::jsonb),
    'consumptions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'accountId', account_id, 'userId', user_id, 'status', status, 'total', total, 'costTotal', cost_total,
      'costStatus', cost_status, 'createdAt', created_at, 'voidedAt', voided_at, 'voidReason', void_reason
    ) order by created_at desc) from public.consumptions), '[]'::jsonb),
    'consumptionItems', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'consumptionId', consumption_id, 'accountId', account_id, 'userId', user_id, 'productId', product_id,
      'productName', product_name, 'quantity', quantity, 'unitPrice', unit_price, 'total', total, 'unitCost', unit_cost,
      'costTotal', cost_total, 'pendingCostQuantity', pending_cost_quantity, 'costStatus', cost_status, 'createdAt', created_at
    ) order by created_at desc) from public.consumption_items), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'accountId', account_id, 'targetType', target_type, 'userId', user_id, 'amount', amount,
      'unappliedAmount', unapplied_amount, 'note', note, 'createdAt', created_at
    ) order by created_at desc) from public.payments), '[]'::jsonb),
    'paymentApplications', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'paymentId', payment_id, 'accountId', account_id, 'userId', user_id,
      'consumptionItemId', consumption_item_id, 'amount', amount, 'createdAt', created_at
    )) from public.payment_applications), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'productId', product_id, 'quantity', quantity, 'unitCost', unit_cost, 'totalCost', total_cost,
      'note', note, 'createdAt', created_at
    ) order by created_at desc) from public.purchases), '[]'::jsonb),
    'inventoryMovements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'productId', product_id, 'type', type, 'quantityDelta', quantity_delta, 'unitCost', unit_cost,
      'referenceId', reference_id, 'note', note, 'createdAt', created_at
    ) order by created_at desc) from public.inventory_movements), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'accountId', account_id, 'scope', scope, 'userId', user_id, 'amount', amount, 'note', note, 'createdAt', created_at
    ) order by created_at desc) from public.adjustments), '[]'::jsonb),
    'accountTransfers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'userId', user_id, 'fromAccountId', from_account_id, 'toAccountId', to_account_id,
      'movedBalance', moved_balance, 'note', note, 'createdAt', created_at
    ) order by created_at desc) from public.account_transfers), '[]'::jsonb)
  );
end;
$$;

create or replace function public.recalculate_fifo_costs(p_product_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_item record;
  v_source record;
  v_remaining numeric;
  v_available numeric;
  v_used numeric;
  v_added_cost numeric;
  v_count integer := 0;
begin
  for v_product in
    select id from public.products where p_product_id is null or id = p_product_id
  loop
    delete from public.fifo_cost_allocations where product_id = v_product.id;

    update public.consumption_items ci
       set unit_cost = 0,
           cost_total = 0,
           pending_cost_quantity = ci.quantity,
           cost_status = 'pending_recalc'
     where ci.product_id = v_product.id;

    for v_item in
      select ci.*
      from public.consumption_items ci
      join public.consumptions c on c.id = ci.consumption_id
      where ci.product_id = v_product.id
        and c.status = 'confirmed'
      order by ci.created_at, ci.id
    loop
      v_remaining := v_item.quantity;
      v_added_cost := 0;

      for v_source in
        select m.*,
               m.quantity_delta - coalesce((
                 select sum(a.quantity)
                 from public.fifo_cost_allocations a
                 where a.source_movement_id = m.id
               ), 0) as available_quantity
        from public.inventory_movements m
        where m.product_id = v_product.id
          and m.quantity_delta > 0
          and m.type in ('purchase', 'adjustment', 'void_consumption')
        order by m.created_at, m.id
      loop
        exit when v_remaining <= 0;
        v_available := greatest(0, v_source.available_quantity);
        if v_available <= 0 then
          continue;
        end if;

        v_used := least(v_remaining, v_available);
        v_remaining := v_remaining - v_used;
        v_added_cost := v_added_cost + (v_used * coalesce(v_source.unit_cost, 0));

        insert into public.fifo_cost_allocations(product_id, consumption_item_id, source_movement_id, quantity, unit_cost, cost_total)
        values (v_product.id, v_item.id, v_source.id, v_used, coalesce(v_source.unit_cost, 0), v_used * coalesce(v_source.unit_cost, 0));
      end loop;

      update public.consumption_items
         set cost_total = v_added_cost,
             unit_cost = case when quantity > 0 then v_added_cost / quantity else 0 end,
             pending_cost_quantity = v_remaining,
             cost_status = case when v_remaining > 0 then 'pending_recalc' else 'final' end
       where id = v_item.id;

      v_count := v_count + 1;
    end loop;

    update public.consumptions c
       set cost_total = coalesce((select sum(cost_total) from public.consumption_items ci where ci.consumption_id = c.id), 0),
           cost_status = case when exists (
             select 1 from public.consumption_items ci where ci.consumption_id = c.id and ci.pending_cost_quantity > 0
           ) then 'pending_recalc' else 'final' end
     where exists (select 1 from public.consumption_items ci where ci.consumption_id = c.id and ci.product_id = v_product.id);
  end loop;

  return jsonb_build_object('updatedItems', v_count);
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
set search_path = public
as $$
declare
  v_admin public.app_users%rowtype;
  v_existing public.admin_audit_log%rowtype;
  v_response jsonb := '{}'::jsonb;
  v_id text;
  v_account_id text;
  v_user_id text;
  v_product public.products%rowtype;
  v_payment_id text;
  v_remaining numeric;
  v_applied numeric;
  v_open record;
  v_balance numeric;
  v_new_account_id text;
begin
  v_admin := public.app_require_admin(p_session_token);

  select * into v_existing
  from public.admin_audit_log
  where idempotency_key = p_idempotency_key;

  if found then
    return coalesce(v_existing.response, '{}'::jsonb);
  end if;

  insert into public.admin_audit_log(admin_user_id, idempotency_key, command, payload)
  values (v_admin.id, p_idempotency_key, p_command, p_payload);

  if p_command = 'create_account' then
    insert into public.accounts(name)
    values (trim(p_payload->>'name'))
    returning id into v_id;
    v_response := jsonb_build_object('id', v_id);

  elsif p_command = 'update_account' then
    update public.accounts
       set name = trim(p_payload->>'name'),
           updated_at = now(),
           version = version + 1
     where id = p_payload->>'id'
       and version = coalesce((p_payload->>'version')::integer, version);
    if not found then raise exception 'Cuenta desactualizada. Refresca antes de guardar.'; end if;

  elsif p_command = 'create_user' then
    declare
      v_salt text := gen_salt('bf');
      v_username text := lower(coalesce(nullif(trim(p_payload->>'username'), ''), regexp_replace(trim(p_payload->>'name'), '\s+', '_', 'g')));
    begin
      insert into public.app_users(account_id, username, name, role, pin_salt, pin_hash)
      values (p_payload->>'accountId', v_username, trim(p_payload->>'name'), coalesce(nullif(p_payload->>'role', ''), 'user'), v_salt, crypt(p_payload->>'pin', v_salt))
      returning id into v_id;
      v_response := jsonb_build_object('id', v_id);
    end;

  elsif p_command = 'update_user' then
    if nullif(p_payload->>'newPin', '') is not null then
      declare
        v_new_salt text := gen_salt('bf');
      begin
        update public.app_users
           set name = trim(p_payload->>'name'),
               status = coalesce(nullif(p_payload->>'status', ''), status),
               pin_salt = v_new_salt,
               pin_hash = crypt(p_payload->>'newPin', v_new_salt),
               updated_at = now(),
               version = version + 1
         where id = p_payload->>'id'
           and version = coalesce((p_payload->>'version')::integer, version);
      end;
    else
      update public.app_users
         set name = trim(p_payload->>'name'),
             status = coalesce(nullif(p_payload->>'status', ''), status),
             updated_at = now(),
             version = version + 1
       where id = p_payload->>'id'
         and version = coalesce((p_payload->>'version')::integer, version);
    end if;
    if not found then raise exception 'Usuario desactualizado. Refresca antes de guardar.'; end if;

  elsif p_command = 'create_product' then
    insert into public.products(name, category, price, stock_min, last_cost, image_url)
    values (
      trim(p_payload->>'name'),
      coalesce(nullif(trim(p_payload->>'category'), ''), 'General'),
      coalesce((p_payload->>'price')::numeric, 0),
      coalesce((p_payload->>'stockMin')::numeric, 0),
      coalesce((p_payload->>'lastCost')::numeric, 0),
      nullif(trim(coalesce(p_payload->>'imageUrl', '')), '')
    )
    returning id into v_id;
    v_response := jsonb_build_object('id', v_id);

  elsif p_command = 'update_product' then
    update public.products
       set name = trim(p_payload->>'name'),
           category = coalesce(nullif(trim(p_payload->>'category'), ''), 'General'),
           price = coalesce((p_payload->>'price')::numeric, price),
           stock_min = coalesce((p_payload->>'stockMin')::numeric, stock_min),
           image_url = nullif(trim(coalesce(p_payload->>'imageUrl', '')), ''),
           status = coalesce(nullif(p_payload->>'status', ''), status),
           updated_at = now(),
           version = version + 1
     where id = p_payload->>'id'
       and version = coalesce((p_payload->>'version')::integer, version);
    if not found then raise exception 'Producto desactualizado. Refresca antes de guardar.'; end if;

  elsif p_command = 'create_purchase' then
    select * into v_product from public.products where id = p_payload->>'productId';
    if not found then raise exception 'Producto no encontrado.'; end if;
    insert into public.purchases(product_id, quantity, unit_cost, total_cost, note)
    values (
      v_product.id,
      (p_payload->>'quantity')::numeric,
      (p_payload->>'unitCost')::numeric,
      (p_payload->>'quantity')::numeric * (p_payload->>'unitCost')::numeric,
      nullif(trim(coalesce(p_payload->>'note', '')), '')
    )
    returning id into v_id;
    insert into public.inventory_movements(product_id, type, quantity_delta, unit_cost, reference_id)
    values (v_product.id, 'purchase', (p_payload->>'quantity')::numeric, (p_payload->>'unitCost')::numeric, v_id);
    update public.products set last_cost = (p_payload->>'unitCost')::numeric, updated_at = now(), version = version + 1 where id = v_product.id;
    perform public.recalculate_fifo_costs(v_product.id);
    v_response := jsonb_build_object('id', v_id);

  elsif p_command = 'create_payment' then
    v_account_id := p_payload->>'accountId';
    perform pg_advisory_xact_lock(hashtext(v_account_id));
    v_payment_id := 'pay_' || gen_random_uuid()::text;
    v_remaining := (p_payload->>'amount')::numeric;
    insert into public.payments(id, account_id, target_type, user_id, amount, unapplied_amount, note)
    values (
      v_payment_id,
      v_account_id,
      case when p_payload->>'targetType' = 'user' then 'user' else 'account' end,
      nullif(p_payload->>'userId', ''),
      v_remaining,
      v_remaining,
      nullif(trim(coalesce(p_payload->>'note', '')), '')
    );

    for v_open in
      select ci.id, ci.user_id, ci.account_id, ci.total - coalesce(sum(pa.amount), 0) as open_amount
      from public.consumption_items ci
      join public.consumptions c on c.id = ci.consumption_id and c.status = 'confirmed'
      left join public.payment_applications pa on pa.consumption_item_id = ci.id
      where ci.account_id = v_account_id
        and (p_payload->>'targetType' <> 'user' or ci.user_id = p_payload->>'userId')
      group by ci.id, ci.user_id, ci.account_id, ci.total, ci.created_at
      having ci.total - coalesce(sum(pa.amount), 0) > 0
      order by ci.created_at, ci.id
    loop
      exit when v_remaining <= 0;
      v_applied := least(v_remaining, v_open.open_amount);
      v_remaining := v_remaining - v_applied;
      insert into public.payment_applications(payment_id, account_id, user_id, consumption_item_id, amount)
      values (v_payment_id, v_open.account_id, v_open.user_id, v_open.id, v_applied);
    end loop;

    update public.payments set unapplied_amount = v_remaining where id = v_payment_id;
    v_response := jsonb_build_object('id', v_payment_id);

  elsif p_command = 'create_adjustment' then
    insert into public.adjustments(account_id, scope, user_id, amount, note)
    values (
      p_payload->>'accountId',
      case when p_payload->>'scope' = 'user' then 'user' else 'account' end,
      nullif(p_payload->>'userId', ''),
      (p_payload->>'amount')::numeric,
      trim(p_payload->>'note')
    )
    returning id into v_id;
    v_response := jsonb_build_object('id', v_id);

  elsif p_command = 'adjust_inventory' then
    select * into v_product from public.products where id = p_payload->>'productId';
    if not found then raise exception 'Producto no encontrado.'; end if;
    insert into public.inventory_movements(product_id, type, quantity_delta, unit_cost, note)
    values (v_product.id, 'adjustment', (p_payload->>'quantityDelta')::numeric, v_product.last_cost, trim(p_payload->>'note'));
    perform public.recalculate_fifo_costs(v_product.id);

  elsif p_command = 'void_consumption' then
    update public.consumptions
       set status = 'voided',
           voided_at = now(),
           void_reason = coalesce(nullif(trim(p_payload->>'reason'), ''), 'Anulado por admin')
     where id = p_payload->>'consumptionId'
       and status = 'confirmed';
    for v_open in select * from public.consumption_items where consumption_id = p_payload->>'consumptionId'
    loop
      insert into public.inventory_movements(product_id, type, quantity_delta, unit_cost, reference_id, note)
      values (v_open.product_id, 'void_consumption', v_open.quantity, v_open.unit_cost, p_payload->>'consumptionId', p_payload->>'reason');
      perform public.recalculate_fifo_costs(v_open.product_id);
    end loop;

  elsif p_command = 'independize_user' then
    v_user_id := p_payload->>'userId';
    select account_id into v_account_id from public.app_users where id = v_user_id;
    v_balance := public.app_user_balance(v_user_id);
    insert into public.accounts(name) values (trim(p_payload->>'newAccountName')) returning id into v_new_account_id;
    insert into public.adjustments(account_id, scope, user_id, amount, note)
    values (v_account_id, 'user', v_user_id, -v_balance, 'Traslado de saldo a nueva cuenta');
    update public.app_users set account_id = v_new_account_id, updated_at = now(), version = version + 1 where id = v_user_id;
    insert into public.adjustments(account_id, scope, user_id, amount, note)
    values (v_new_account_id, 'user', v_user_id, v_balance, 'Saldo trasladado desde cuenta anterior');
    insert into public.account_transfers(user_id, from_account_id, to_account_id, moved_balance, note)
    values (v_user_id, v_account_id, v_new_account_id, v_balance, 'Independizacion de usuario')
    returning id into v_id;
    v_response := jsonb_build_object('id', v_id);

  elsif p_command = 'merge_accounts' then
    for v_open in select * from public.app_users where account_id = p_payload->>'sourceAccountId' and status = 'active'
    loop
      v_balance := public.app_user_balance(v_open.id);
      insert into public.adjustments(account_id, scope, user_id, amount, note)
      values (p_payload->>'sourceAccountId', 'user', v_open.id, -v_balance, 'Traslado por union de cuentas');
      update public.app_users set account_id = p_payload->>'targetAccountId', updated_at = now(), version = version + 1 where id = v_open.id;
      insert into public.adjustments(account_id, scope, user_id, amount, note)
      values (p_payload->>'targetAccountId', 'user', v_open.id, v_balance, 'Saldo trasladado desde cuenta unida');
      insert into public.account_transfers(user_id, from_account_id, to_account_id, moved_balance, note)
      values (v_open.id, p_payload->>'sourceAccountId', p_payload->>'targetAccountId', v_balance, 'Union de cuentas');
    end loop;
    update public.accounts set status = 'inactive', updated_at = now(), version = version + 1 where id = p_payload->>'sourceAccountId';

  elsif p_command = 'recalculate_fifo' then
    v_response := public.recalculate_fifo_costs(nullif(p_payload->>'productId', ''));

  else
    raise exception 'Comando admin no soportado: %', p_command;
  end if;

  update public.admin_audit_log
     set response = v_response
   where idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

alter table public.accounts enable row level security;
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.products enable row level security;
alter table public.consumptions enable row level security;
alter table public.consumption_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_applications enable row level security;
alter table public.purchases enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.adjustments enable row level security;
alter table public.account_transfers enable row level security;
alter table public.fifo_cost_allocations enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.accounts from anon, authenticated;
revoke all on public.app_users from anon, authenticated;
revoke all on public.app_sessions from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.consumptions from anon, authenticated;
revoke all on public.consumption_items from anon, authenticated;
revoke all on public.payments from anon, authenticated;
revoke all on public.payment_applications from anon, authenticated;
revoke all on public.purchases from anon, authenticated;
revoke all on public.inventory_movements from anon, authenticated;
revoke all on public.adjustments from anon, authenticated;
revoke all on public.account_transfers from anon, authenticated;
revoke all on public.fifo_cost_allocations from anon, authenticated;
revoke all on public.admin_audit_log from anon, authenticated;

grant execute on function public.login_pin(text, text, text, text) to anon, authenticated;
grant execute on function public.change_my_pin(text, text, text) to anon, authenticated;
grant execute on function public.get_user_catalog(text, integer) to anon, authenticated;
grant execute on function public.create_consumption(text, text, text, integer, jsonb) to anon, authenticated;
grant execute on function public.admin_get_snapshot(text) to anon, authenticated;
grant execute on function public.admin_command(text, text, text, jsonb) to anon, authenticated;

-- Bootstrap example:
-- insert into public.accounts(name) values ('Cuenta principal') returning id;
-- with salt as (select gen_salt('bf') as value)
-- insert into public.app_users(account_id, username, name, role, pin_salt, pin_hash)
-- select 'acct_id', 'admin', 'Administrador', 'admin', value, crypt('0000', value)
-- from salt;
