-- Datos demostrativos ricos y repetibles para APP_TIENDA v2.
-- Credenciales locales de demostracion:
--   admin / 0000
--   ana, luis, maria, carlos, sofia, diego / 1234
-- Cambia todos estos PIN inmediatamente antes de usar el proyecto en produccion.

begin;

select set_config('app.audit_disabled', 'on', true);

insert into public.accounts(id, name, status)
values
  ('10000000-0000-4000-8000-000000000001', 'Cuenta principal', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'Equipo operativo', 'active')
on conflict (id) do update
set name = excluded.name,
    status = 'active';

create temp table demo_users (
  user_id uuid primary key,
  account_id uuid,
  username text,
  display_name text,
  user_role text,
  pin text
) on commit drop;

insert into demo_users values
  ('20000000-0000-4000-8000-000000000001', null, 'admin', 'Administrador', 'admin', '0000'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'ana', 'Ana', 'user', '1234'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'luis', 'Luis', 'user', '1234'),
  (public.app_uuid('demo-user-maria'), '10000000-0000-4000-8000-000000000001', 'maria', 'Maria', 'user', '1234'),
  (public.app_uuid('demo-user-carlos'), '10000000-0000-4000-8000-000000000001', 'carlos', 'Carlos', 'user', '1234'),
  (public.app_uuid('demo-user-sofia'), '10000000-0000-4000-8000-000000000002', 'sofia', 'Sofia', 'user', '1234'),
  (public.app_uuid('demo-user-diego'), '10000000-0000-4000-8000-000000000002', 'diego', 'Diego', 'user', '1234');

do $$
declare
  v_user demo_users%rowtype;
  v_salt text;
begin
  for v_user in select * from demo_users loop
    v_salt := extensions.gen_salt('bf');
    insert into public.app_users(
      id, account_id, username, name, role, pin_salt, pin_hash, status
    ) values (
      v_user.user_id,
      v_user.account_id,
      v_user.username,
      v_user.display_name,
      v_user.user_role,
      v_salt,
      extensions.crypt(v_user.pin, v_salt),
      'active'
    )
    on conflict (id) do update
    set account_id = excluded.account_id,
        username = excluded.username,
        name = excluded.name,
        role = excluded.role,
        pin_salt = excluded.pin_salt,
        pin_hash = excluded.pin_hash,
        status = 'active';
  end loop;
end;
$$;

create temp table demo_products (
  product_id uuid primary key,
  product_key text unique,
  product_name text,
  category text,
  price numeric(14,2),
  stock_min numeric(14,3),
  initial_stock numeric(14,3),
  unit_cost numeric(14,2),
  image_url text
) on commit drop;

insert into demo_products values
  ('30000000-0000-4000-8000-000000000001', 'agua', 'Agua Cristal 600 ml', 'Bebidas', 2000, 8, 20, 950, 'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-coca-cola'), 'coca_cola', 'Coca-Cola 400 ml', 'Bebidas', 3500, 8, 20, 2100, 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-coca-zero'), 'coca_zero', 'Coca-Cola Zero 400 ml', 'Bebidas', 3500, 6, 16, 2200, 'https://images.unsplash.com/photo-1629203849820-fdd70d49c38e?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-pony-malta'), 'pony_malta', 'Pony Malta 1.5 L', 'Bebidas', 6900, 5, 12, 4400, 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-jugo-hit'), 'jugo_hit', 'Jugo Hit Mora 500 ml', 'Bebidas', 3200, 6, 18, 1800, 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-gatorade'), 'gatorade', 'Gatorade Tropical 500 ml', 'Bebidas', 5500, 4, 12, 3600, 'https://images.unsplash.com/photo-1625772299848-391b6a87d7b3?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-red-bull'), 'red_bull', 'Red Bull 250 ml', 'Bebidas', 8500, 4, 6, 6200, 'https://images.unsplash.com/photo-1553456558-aff63285bdd1?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-papas'), 'papas', 'Papas Margarita Limon', 'Snacks', 3000, 6, 20, 1700, 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-doritos'), 'doritos', 'Doritos Mega Queso 43 g', 'Snacks', 3500, 6, 10, 2200, 'https://images.unsplash.com/photo-1600952841320-db92ec4047ca?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-choclitos'), 'choclitos', 'Choclitos Limon', 'Snacks', 2800, 5, 15, 1600, 'https://images.unsplash.com/photo-1613919113640-25732ec5e61f?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-cheetos'), 'cheetos', 'Cheetos Queso', 'Snacks', 3000, 5, 14, 1800, 'https://images.unsplash.com/photo-1600952841320-db92ec4047ca?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-natuchips'), 'natuchips', 'Natuchips Platano', 'Snacks', 3000, 5, 12, 1750, 'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-mani'), 'mani', 'Mani Salado', 'Snacks', 2500, 5, 16, 1400, 'https://images.unsplash.com/photo-1567892737950-30c4db37cd89?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-oreo'), 'oreo', 'Oreo Original', 'Dulces', 2800, 6, 18, 1500, 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=640&q=75'),
  ('30000000-0000-4000-8000-000000000002', 'festival', 'Galletas Festival Chocolate', 'Dulces', 2500, 4, 15, 1200, 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-chocorramo'), 'chocorramo', 'Chocorramo', 'Dulces', 2800, 6, 18, 1600, 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-jet'), 'chocolate_jet', 'Chocolate Jet', 'Dulces', 2200, 6, 20, 1300, 'https://images.unsplash.com/photo-1606312619070-d48b4c652a52?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-bonbonbum'), 'bon_bon_bum', 'Bon Bon Bum', 'Dulces', 800, 10, 30, 350, 'https://images.unsplash.com/photo-1581798459219-318e76aecc7b?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-snickers'), 'snickers', 'Snickers', 'Dulces', 4500, 3, 2, 2900, 'https://images.unsplash.com/photo-1575377427642-087cf684f29d?auto=format&fit=crop&w=640&q=75'),
  ('30000000-0000-4000-8000-000000000003', 'cafe', 'Cafe frio', 'Preparados', 4500, 8, 25, 700, 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-avena'), 'avena', 'Avena Alpina', 'Lacteos', 4000, 5, 14, 2400, 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-sandwich'), 'sandwich', 'Sandwich jamon y queso', 'Preparados', 6500, 4, 10, 3900, 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-croissant'), 'croissant', 'Mini Croissant', 'Panaderia', 3500, 5, 12, 1900, 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-yogurt'), 'yogurt', 'Yogurt Alpina 200 g', 'Lacteos', 4500, 5, 14, 2700, 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-barra'), 'barra_cereal', 'Barra de cereal', 'Saludables', 2200, 5, 18, 1100, 'https://images.unsplash.com/photo-1571748982800-fa51082c2224?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-helado'), 'helado', 'Helado de paleta', 'Congelados', 3500, 3, 1, 1900, 'https://images.unsplash.com/photo-1501443762994-82bd5dace89a?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-aguila'), 'aguila', 'Cerveza Aguila 330 ml', 'Cervezas', 5000, 6, 18, 3100, 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-poker'), 'poker', 'Cerveza Poker 330 ml', 'Cervezas', 5500, 6, 16, 3300, 'https://images.unsplash.com/photo-1612528443702-f6741f70a049?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-atun'), 'atun', 'Atun Van Camps', 'Despensa', 7500, 4, 10, 4800, 'https://images.unsplash.com/photo-1580959375944-abd7e991f971?auto=format&fit=crop&w=640&q=75'),
  (public.app_uuid('demo-product-salchichas'), 'salchichas', 'Salchichas Zenu', 'Despensa', 6200, 4, 10, 3900, 'https://images.unsplash.com/photo-1585325701165-351af916e581?auto=format&fit=crop&w=640&q=75');

insert into public.products(
  id, name, category, price, stock_min,
  image_url, image_source_url, image_credit, status
)
select
  product_id, product_name, category, price, stock_min,
  image_url, 'https://unsplash.com/', 'Unsplash', 'active'
from demo_products
on conflict (id) do update
set name = excluded.name,
    category = excluded.category,
    price = excluded.price,
    stock_min = excluded.stock_min,
    image_url = excluded.image_url,
    image_source_url = excluded.image_source_url,
    image_credit = excluded.image_credit,
    status = 'active';

insert into public.inventory_movements(
  id, product_id, movement_type, quantity_delta, unit_cost,
  note, created_by, request_id, created_at
)
select
  public.app_uuid('demo-purchase-' || d.product_key),
  d.product_id,
  'purchase',
  d.initial_stock,
  d.unit_cost,
  'Inventario demo inicial',
  '20000000-0000-4000-8000-000000000001',
  public.app_uuid('demo-purchase-request-' || d.product_key),
  '2026-06-25 08:00:00-05'::timestamptz + row_number() over (order by d.product_key) * interval '1 minute'
from demo_products d
where not exists (
  select 1
  from public.inventory_movements m
  where m.product_id = d.product_id
    and m.movement_type = 'purchase'
    and m.note = 'Inventario demo inicial'
)
on conflict (id) do nothing;

create temp table demo_consumption_lines (
  sale_key text,
  username text,
  occurred_at timestamptz,
  product_key text,
  quantity numeric(14,3)
) on commit drop;

insert into demo_consumption_lines values
  ('s01', 'ana',    '2026-06-30 09:15:00-05', 'agua', 2),
  ('s01', 'ana',    '2026-06-30 09:15:00-05', 'doritos', 1),
  ('s02', 'luis',   '2026-07-01 10:40:00-05', 'coca_cola', 2),
  ('s02', 'luis',   '2026-07-01 10:40:00-05', 'chocorramo', 1),
  ('s03', 'maria',  '2026-07-02 14:10:00-05', 'pony_malta', 1),
  ('s03', 'maria',  '2026-07-02 14:10:00-05', 'festival', 1),
  ('s04', 'carlos', '2026-07-03 08:25:00-05', 'gatorade', 1),
  ('s04', 'carlos', '2026-07-03 08:25:00-05', 'cheetos', 1),
  ('s05', 'sofia',  '2026-07-04 16:35:00-05', 'jugo_hit', 1),
  ('s05', 'sofia',  '2026-07-04 16:35:00-05', 'oreo', 1),
  ('s06', 'ana',    '2026-07-05 11:20:00-05', 'yogurt', 1),
  ('s06', 'ana',    '2026-07-05 11:20:00-05', 'barra_cereal', 1),
  ('s07', 'luis',   '2026-07-06 17:05:00-05', 'red_bull', 1),
  ('s07', 'luis',   '2026-07-06 17:05:00-05', 'mani', 1),
  ('s08', 'maria',  '2026-07-07 12:45:00-05', 'sandwich', 1),
  ('s08', 'maria',  '2026-07-07 12:45:00-05', 'cafe', 1),
  ('s09', 'carlos', '2026-07-08 15:30:00-05', 'snickers', 1),
  ('s09', 'carlos', '2026-07-08 15:30:00-05', 'avena', 1),
  ('s10', 'sofia',  '2026-07-09 18:15:00-05', 'aguila', 1),
  ('s10', 'sofia',  '2026-07-09 18:15:00-05', 'salchichas', 1),
  ('s11', 'ana',    '2026-07-10 09:50:00-05', 'coca_zero', 1),
  ('s11', 'ana',    '2026-07-10 09:50:00-05', 'papas', 1),
  ('s12', 'diego',  '2026-07-10 13:25:00-05', 'red_bull', 1),
  ('s12', 'diego',  '2026-07-10 13:25:00-05', 'doritos', 1),
  ('s13', 'luis',   '2026-07-11 10:05:00-05', 'atun', 1),
  ('s13', 'luis',   '2026-07-11 10:05:00-05', 'agua', 1),
  ('s14', 'maria',  '2026-07-11 19:10:00-05', 'poker', 1),
  ('s14', 'maria',  '2026-07-11 19:10:00-05', 'natuchips', 1),
  ('s15', 'carlos', '2026-07-12 14:40:00-05', 'coca_zero', 1),
  ('s15', 'carlos', '2026-07-12 14:40:00-05', 'helado', 1),
  ('s16', 'diego',  '2026-07-13 16:20:00-05', 'cafe', 2),
  ('s16', 'diego',  '2026-07-13 16:20:00-05', 'croissant', 1);

insert into public.consumptions(
  id, client_operation_id, account_id, user_id, device_id,
  catalog_version, status, total, request_id, created_at
)
select
  public.app_uuid('demo-consumption-' || l.sale_key),
  public.app_uuid('demo-operation-' || l.sale_key),
  u.account_id,
  u.id,
  'kiosco-demo',
  max(p.version),
  'confirmed',
  sum(l.quantity * d.price),
  public.app_uuid('demo-consumption-request-' || l.sale_key),
  l.occurred_at
from demo_consumption_lines l
join public.app_users u on u.username = l.username
join demo_products d on d.product_key = l.product_key
join public.products p on p.id = d.product_id
group by l.sale_key, l.username, l.occurred_at, u.id, u.account_id
on conflict (id) do nothing;

insert into public.consumption_items(
  id, consumption_id, account_id, user_id, product_id,
  product_name, quantity, unit_price, created_at
)
select
  public.app_uuid('demo-item-' || l.sale_key || '-' || l.product_key),
  public.app_uuid('demo-consumption-' || l.sale_key),
  u.account_id,
  u.id,
  d.product_id,
  d.product_name,
  l.quantity,
  d.price,
  l.occurred_at
from demo_consumption_lines l
join public.app_users u on u.username = l.username
join demo_products d on d.product_key = l.product_key
on conflict (id) do nothing;

insert into public.inventory_movements(
  id, product_id, movement_type, quantity_delta, consumption_item_id,
  note, created_by, request_id, created_at
)
select
  public.app_uuid('demo-consumption-movement-' || l.sale_key || '-' || l.product_key),
  d.product_id,
  'consumption',
  -l.quantity,
  public.app_uuid('demo-item-' || l.sale_key || '-' || l.product_key),
  'Salida por consumo demo',
  u.id,
  public.app_uuid('demo-consumption-request-' || l.sale_key),
  l.occurred_at + interval '1 second'
from demo_consumption_lines l
join public.app_users u on u.username = l.username
join demo_products d on d.product_key = l.product_key
on conflict (id) do nothing;

select public.app_allocate_pending_fifo();

create temp table demo_payments (
  payment_key text,
  username text,
  amount numeric(14,2),
  occurred_at timestamptz
) on commit drop;

insert into demo_payments values
  ('p01', 'ana', 12000, '2026-07-10 18:00:00-05'),
  ('p02', 'luis', 30300, '2026-07-13 18:10:00-05'),
  ('p03', 'maria', 20000, '2026-07-13 18:20:00-05'),
  ('p04', 'carlos', 10000, '2026-07-13 18:30:00-05'),
  ('p05', 'sofia', 20000, '2026-07-13 18:40:00-05'),
  ('p06', 'diego', 5000, '2026-07-13 18:50:00-05');

insert into public.financial_movements(
  id, movement_type, account_id, scope, user_id, paid_by_user_id,
  amount, note, created_by, request_id, created_at
)
select
  public.app_uuid('demo-payment-' || p.payment_key),
  'payment',
  u.account_id,
  'user',
  u.id,
  u.id,
  p.amount,
  'Pago demo de ' || u.name,
  '20000000-0000-4000-8000-000000000001',
  public.app_uuid('demo-payment-request-' || p.payment_key),
  p.occurred_at
from demo_payments p
join public.app_users u on u.username = p.username
on conflict (id) do nothing;

select public.app_apply_payment(public.app_uuid('demo-payment-' || payment_key))
from demo_payments
order by occurred_at;

insert into public.financial_movements(
  id, movement_type, account_id, scope, user_id,
  amount, note, created_by, request_id, created_at
)
values
  (
    public.app_uuid('demo-adjustment-carlos'), 'adjustment',
    '10000000-0000-4000-8000-000000000001', 'user', public.app_uuid('demo-user-carlos'),
    -1500, 'Cortesia demo', '20000000-0000-4000-8000-000000000001',
    public.app_uuid('demo-adjustment-request-carlos'), '2026-07-13 19:00:00-05'
  ),
  (
    public.app_uuid('demo-adjustment-maria'), 'adjustment',
    '10000000-0000-4000-8000-000000000001', 'user', public.app_uuid('demo-user-maria'),
    2000, 'Ajuste de saldo demo', '20000000-0000-4000-8000-000000000001',
    public.app_uuid('demo-adjustment-request-maria'), '2026-07-13 19:05:00-05'
  ),
  (
    public.app_uuid('demo-adjustment-equipo'), 'adjustment',
    '10000000-0000-4000-8000-000000000002', 'account', null,
    3000, 'Ajuste de cuenta demo', '20000000-0000-4000-8000-000000000001',
    public.app_uuid('demo-adjustment-request-equipo'), '2026-07-13 19:10:00-05'
  )
on conflict (id) do nothing;

insert into public.audit_log(
  id, request_id, actor_user_id, actor_name, action, entity_type,
  record_id, changed_fields, reason, device_id, metadata, created_at
)
values
  (
    public.app_uuid('demo-audit-catalog'), public.app_uuid('demo-audit-request-catalog'),
    '20000000-0000-4000-8000-000000000001', 'Administrador', 'update', 'products',
    public.app_uuid('demo-product-red-bull'), array['price', 'stock_min'],
    'Actualizacion demostrativa del catalogo', 'admin-demo', '{"source":"seed"}'::jsonb,
    '2026-07-10 08:00:00-05'
  ),
  (
    public.app_uuid('demo-audit-inventory'), public.app_uuid('demo-audit-request-inventory'),
    '20000000-0000-4000-8000-000000000001', 'Administrador', 'create', 'inventory_movements',
    public.app_uuid('demo-purchase-papas'), array['quantity_delta', 'unit_cost'],
    'Compra de inventario demostrativa', 'admin-demo', '{"source":"seed"}'::jsonb,
    '2026-07-11 08:30:00-05'
  ),
  (
    public.app_uuid('demo-audit-payment'), public.app_uuid('demo-audit-request-payment'),
    '20000000-0000-4000-8000-000000000001', 'Administrador', 'create', 'financial_movements',
    public.app_uuid('demo-payment-p02'), array['amount'],
    'Registro de pago demostrativo', 'admin-demo', '{"source":"seed"}'::jsonb,
    '2026-07-13 18:10:00-05'
  ),
  (
    public.app_uuid('demo-audit-adjustment'), public.app_uuid('demo-audit-request-adjustment'),
    '20000000-0000-4000-8000-000000000001', 'Administrador', 'create', 'financial_movements',
    public.app_uuid('demo-adjustment-carlos'), array['amount', 'note'],
    'Cortesia demostrativa', 'admin-demo', '{"source":"seed"}'::jsonb,
    '2026-07-13 19:00:00-05'
  )
on conflict (id) do nothing;

commit;
