-- Datos demostrativos repetibles para APP_TIENDA v2.
-- Credenciales locales de demostracion:
--   admin / 0000
--   ana / 1234
--   luis / 1234
-- Cambia todos estos PIN inmediatamente antes de usar el proyecto en produccion.

begin;

select set_config('app.audit_disabled', 'on', true);

insert into public.accounts(id, name, status)
values ('10000000-0000-4000-8000-000000000001', 'Cuenta principal', 'active')
on conflict (id) do update
set name = excluded.name,
    status = 'active';

do $$
declare
  v_salt text;
begin
  v_salt := extensions.gen_salt('bf');
  insert into public.app_users(
    id, account_id, username, name, role, pin_salt, pin_hash, status
  )
  values (
    '20000000-0000-4000-8000-000000000001',
    null,
    'admin',
    'Administrador',
    'admin',
    v_salt,
    extensions.crypt('0000', v_salt),
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

  v_salt := extensions.gen_salt('bf');
  insert into public.app_users(
    id, account_id, username, name, role, pin_salt, pin_hash, status
  )
  values (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'ana',
    'Ana',
    'user',
    v_salt,
    extensions.crypt('1234', v_salt),
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

  v_salt := extensions.gen_salt('bf');
  insert into public.app_users(
    id, account_id, username, name, role, pin_salt, pin_hash, status
  )
  values (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'luis',
    'Luis',
    'user',
    v_salt,
    extensions.crypt('1234', v_salt),
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
end;
$$;

insert into public.products(
  id, name, category, price, stock_min, status
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'Agua',
    'Bebidas',
    2000.00,
    5.000,
    'active'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'Galletas',
    'Snacks',
    2500.00,
    4.000,
    'active'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'Cafe',
    'Bebidas',
    1800.00,
    8.000,
    'active'
  )
on conflict (id) do update
set name = excluded.name,
    category = excluded.category,
    price = excluded.price,
    stock_min = excluded.stock_min,
    status = 'active';

insert into public.inventory_movements(
  id, product_id, movement_type, quantity_delta, unit_cost,
  note, created_by, request_id, created_at
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'purchase',
    20.000,
    1000.00,
    'Inventario demo inicial',
    '20000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '2026-07-14 08:00:00-05'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'purchase',
    15.000,
    1200.00,
    'Inventario demo inicial',
    '20000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '2026-07-14 08:00:00-05'
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000003',
    'purchase',
    25.000,
    700.00,
    'Inventario demo inicial',
    '20000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '2026-07-14 08:00:00-05'
  )
on conflict (id) do nothing;

commit;
