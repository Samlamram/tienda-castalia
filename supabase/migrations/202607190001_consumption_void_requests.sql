begin;

create table public.consumption_void_requests (
  id uuid primary key default gen_random_uuid(),
  consumption_id uuid not null references public.consumptions(id),
  requested_by_user_id uuid not null references public.app_users(id),
  reason text not null check (length(trim(reason)) >= 3),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_user_id uuid references public.app_users(id),
  reviewed_at timestamptz,
  decision_reason text,
  request_id uuid not null unique,
  decision_request_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  constraint consumption_void_request_review_ck check (
    (status = 'pending' and reviewed_by_user_id is null and reviewed_at is null and decision_reason is null and decision_request_id is null)
    or
    (status in ('approved', 'rejected') and reviewed_by_user_id is not null and reviewed_at is not null
      and nullif(trim(decision_reason), '') is not null and decision_request_id is not null)
  )
);

create unique index consumption_void_requests_pending_uidx
  on public.consumption_void_requests (consumption_id)
  where status = 'pending';
create index consumption_void_requests_status_created_idx
  on public.consumption_void_requests (status, created_at desc, id desc);
create index consumption_void_requests_user_created_idx
  on public.consumption_void_requests (requested_by_user_id, created_at desc, id desc);

create or replace function public.app_guard_consumption_void_request()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las solicitudes de anulacion no se eliminan.';
  end if;

  if old.status = 'pending'
     and new.status in ('approved', 'rejected')
     and (to_jsonb(new) - array['status', 'reviewed_by_user_id', 'reviewed_at', 'decision_reason', 'decision_request_id'])
         = (to_jsonb(old) - array['status', 'reviewed_by_user_id', 'reviewed_at', 'decision_reason', 'decision_request_id'])
  then
    return new;
  end if;

  raise exception 'La solicitud es inmutable y solo puede resolverse una vez.';
end;
$$;

create trigger consumption_void_requests_10_guard
before update or delete on public.consumption_void_requests
for each row execute function public.app_guard_consumption_void_request();

create trigger consumption_void_requests_90_audit
after insert or update or delete on public.consumption_void_requests
for each row execute function public.app_write_audit();

alter table public.consumption_void_requests enable row level security;

create or replace function public.request_consumption_void(
  p_session_token text,
  p_idempotency_key text,
  p_consumption_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
  v_consumption public.consumptions%rowtype;
  v_existing public.consumption_void_requests%rowtype;
  v_request uuid;
  v_id uuid;
begin
  v_user := public.app_current_user(p_session_token);
  if v_user.role <> 'user' then
    raise exception 'Solo usuarios pueden solicitar la anulacion de una compra.';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key requerido.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Explica el motivo con al menos 3 caracteres.';
  end if;

  v_request := public.app_uuid(trim(p_idempotency_key));
  perform pg_advisory_xact_lock(hashtextextended(v_request::text, 7));

  select * into v_existing
  from public.consumption_void_requests
  where request_id = v_request;
  if found then
    if v_existing.consumption_id <> p_consumption_id
       or v_existing.requested_by_user_id <> v_user.id
       or v_existing.reason <> trim(p_reason)
    then
      raise exception 'La clave de idempotencia ya fue usada con otra solicitud.';
    end if;
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status);
  end if;

  select * into v_consumption
  from public.consumptions
  where id = p_consumption_id
    and user_id = v_user.id
    and status = 'confirmed'
  for update;
  if not found then
    raise exception 'Compra no encontrada, no pertenece al usuario o ya fue anulada.';
  end if;

  if exists (
    select 1 from public.consumption_void_requests
    where consumption_id = v_consumption.id and status = 'pending'
  ) then
    raise exception 'Esta compra ya tiene una solicitud de anulacion pendiente.';
  end if;

  perform public.app_set_context(
    v_user.id,
    v_user.name,
    v_request,
    nullif(current_setting('app.device_id', true), ''),
    trim(p_reason)
  );

  insert into public.consumption_void_requests(
    consumption_id, requested_by_user_id, reason, request_id
  ) values (
    v_consumption.id, v_user.id, trim(p_reason), v_request
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

create or replace function public.get_consumption_void_requests(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
begin
  v_user := public.app_current_user(p_session_token);

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', scoped.id,
        'consumptionId', scoped.consumption_id,
        'requestedByUserId', scoped.requested_by_user_id,
        'requestedByName', scoped.requested_by_name,
        'reason', scoped.reason,
        'status', scoped.status,
        'reviewedByUserId', scoped.reviewed_by_user_id,
        'reviewedByName', scoped.reviewed_by_name,
        'reviewedAt', scoped.reviewed_at,
        'decisionReason', scoped.decision_reason,
        'createdAt', scoped.created_at
      ) order by (scoped.status = 'pending') desc, scoped.created_at desc, scoped.id desc)
      from (
        select r.*, requester.name as requested_by_name, reviewer.name as reviewed_by_name
        from public.consumption_void_requests r
        join public.app_users requester on requester.id = r.requested_by_user_id
        left join public.app_users reviewer on reviewer.id = r.reviewed_by_user_id
        where v_user.role = 'admin' or r.requested_by_user_id = v_user.id
        order by (r.status = 'pending') desc, r.created_at desc, r.id desc
        limit 200
      ) scoped
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_review_consumption_void_request(
  p_session_token text,
  p_idempotency_key text,
  p_request_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.app_users%rowtype;
  v_void_request public.consumption_void_requests%rowtype;
  v_decision_request uuid;
  v_decision_reason text;
  v_void_reason text;
begin
  v_admin := public.app_require_admin(p_session_token);
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key requerido.';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision invalida.';
  end if;
  if p_decision = 'rejected' and length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'El motivo de rechazo debe tener al menos 3 caracteres.';
  end if;

  v_decision_request := public.app_uuid(trim(p_idempotency_key));
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 8));

  select * into v_void_request
  from public.consumption_void_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Solicitud de anulacion no encontrada.';
  end if;

  if v_void_request.status <> 'pending' then
    if v_void_request.status = p_decision and v_void_request.decision_request_id = v_decision_request then
      return jsonb_build_object('id', v_void_request.id, 'status', v_void_request.status);
    end if;
    raise exception 'La solicitud ya fue resuelta.';
  end if;

  v_decision_reason := case
    when nullif(trim(coalesce(p_reason, '')), '') is not null then trim(p_reason)
    when p_decision = 'approved' then 'Solicitud aprobada por el administrador.'
    else null
  end;

  if p_decision = 'approved' then
    v_void_reason := case
      when nullif(trim(coalesce(p_reason, '')), '') is null then v_void_request.reason
      else concat(v_void_request.reason, ' Nota del administrador: ', trim(p_reason))
    end;

    perform public.admin_command(
      p_session_token,
      'void-request:' || v_void_request.id::text,
      'void_consumption',
      jsonb_build_object(
        'consumptionId', v_void_request.consumption_id,
        'reason', v_void_reason,
        'voidRequestId', v_void_request.id
      )
    );
  else
    perform public.app_set_context(
      v_admin.id,
      v_admin.name,
      v_decision_request,
      nullif(current_setting('app.device_id', true), ''),
      v_decision_reason
    );
  end if;

  update public.consumption_void_requests
  set status = p_decision,
      reviewed_by_user_id = v_admin.id,
      reviewed_at = clock_timestamp(),
      decision_reason = v_decision_reason,
      decision_request_id = v_decision_request
  where id = v_void_request.id;

  return jsonb_build_object('id', v_void_request.id, 'status', p_decision);
end;
$$;

revoke all on table public.consumption_void_requests from public, anon, authenticated;
revoke all on function public.request_consumption_void(text, text, uuid, text) from public;
revoke all on function public.get_consumption_void_requests(text) from public;
revoke all on function public.admin_review_consumption_void_request(text, text, uuid, text, text) from public;
grant execute on function public.request_consumption_void(text, text, uuid, text) to anon, authenticated;
grant execute on function public.get_consumption_void_requests(text) to anon, authenticated;
grant execute on function public.admin_review_consumption_void_request(text, text, uuid, text, text) to anon, authenticated;

commit;