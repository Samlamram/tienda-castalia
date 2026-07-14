begin;

create table public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  old_price numeric(14,2) check (old_price is null or old_price >= 0),
  new_price numeric(14,2) not null check (new_price >= 0),
  changed_by uuid references public.app_users(id),
  reason text,
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  constraint product_price_history_change_ck check (
    old_price is null or old_price is distinct from new_price
  )
);

create index product_price_history_product_created_idx
  on public.product_price_history (product_id, created_at desc, id desc);
create index product_price_history_request_idx
  on public.product_price_history (request_id);

create or replace function public.app_record_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.price is distinct from old.price then
    insert into public.product_price_history(
      product_id, old_price, new_price, changed_by, reason, request_id
    ) values (
      new.id,
      case when tg_op = 'INSERT' then null else old.price end,
      new.price,
      public.app_context_uuid('app.actor_user_id'),
      coalesce(
        nullif(current_setting('app.reason', true), ''),
        case when tg_op = 'INSERT' then 'Precio inicial' else 'Cambio de precio' end
      ),
      coalesce(public.app_context_uuid('app.request_id'), gen_random_uuid())
    );
  end if;
  return new;
end;
$$;

create trigger products_80_price_history
after insert or update of price on public.products
for each row execute function public.app_record_product_price_change();

create trigger product_price_history_10_immutable
before update or delete on public.product_price_history
for each row execute function public.app_block_immutable();

-- Punto de partida para productos creados antes de instalar esta migracion.
insert into public.product_price_history(
  product_id, old_price, new_price, reason, request_id, created_at
)
select
  p.id,
  null,
  p.price,
  'Precio vigente al habilitar historial',
  gen_random_uuid(),
  clock_timestamp()
from public.products p
where not exists (
  select 1 from public.product_price_history h where h.product_id = p.id
);

create or replace function public.admin_get_product_price_history(
  p_session_token text,
  p_product_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.app_users%rowtype;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 200);
  v_total bigint;
  v_items jsonb;
begin
  v_admin := public.app_require_admin(p_session_token);

  select count(*) into v_total
  from public.product_price_history h
  where p_product_id is null or h.product_id = p_product_id;

  select coalesce(jsonb_agg(entry order by created_at desc, id desc), '[]'::jsonb)
    into v_items
  from (
    select
      h.id,
      h.created_at,
      jsonb_build_object(
        'id', h.id,
        'productId', h.product_id,
        'productName', p.name,
        'oldPrice', h.old_price,
        'newPrice', h.new_price,
        'changedBy', h.changed_by,
        'changedByName', u.name,
        'reason', h.reason,
        'requestId', h.request_id,
        'createdAt', h.created_at
      ) as entry
    from public.product_price_history h
    join public.products p on p.id = h.product_id
    left join public.app_users u on u.id = h.changed_by
    where p_product_id is null or h.product_id = p_product_id
    order by h.created_at desc, h.id desc
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

alter table public.product_price_history enable row level security;
revoke all on table public.product_price_history from public, anon, authenticated;
revoke all on function public.app_record_product_price_change() from public, anon, authenticated;
revoke all on function public.admin_get_product_price_history(text, uuid, integer, integer) from public;
grant execute on function public.admin_get_product_price_history(text, uuid, integer, integer)
  to anon, authenticated;

commit;
