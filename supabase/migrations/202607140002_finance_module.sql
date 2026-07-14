begin;

create table public.store_finance_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in (
      'capital_contribution', 'expense', 'owner_withdrawal',
      'capital_contribution_reversal', 'expense_reversal', 'owner_withdrawal_reversal'
    )
  ),
  amount numeric(14,2) not null check (amount > 0),
  beneficiary text,
  note text not null check (nullif(trim(note), '') is not null),
  reversed_event_id uuid unique references public.store_finance_events(id),
  created_by uuid references public.app_users(id),
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  constraint store_finance_events_reversal_ck check (
    (event_type like '%_reversal') = (reversed_event_id is not null)
  )
);

create index store_finance_events_created_idx
  on public.store_finance_events (created_at desc, id desc);
create index store_finance_events_request_idx
  on public.store_finance_events (request_id);

create trigger store_finance_events_10_immutable
before update or delete on public.store_finance_events
for each row execute function public.app_block_immutable();

create trigger store_finance_events_90_audit
after insert or update or delete on public.store_finance_events
for each row execute function public.app_write_audit();

alter table public.store_finance_events enable row level security;
revoke all on table public.store_finance_events from public, anon, authenticated;

create or replace function public.admin_get_finance_events(p_session_token text)
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
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'eventType', e.event_type,
        'amount', e.amount,
        'beneficiary', e.beneficiary,
        'note', e.note,
        'reversedEventId', e.reversed_event_id,
        'createdBy', e.created_by,
        'requestId', e.request_id,
        'createdAt', e.created_at
      ) order by e.created_at desc, e.id desc)
      from public.store_finance_events e
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_finance_command(
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
  v_original public.store_finance_events%rowtype;
  v_request uuid;
  v_id uuid;
  v_amount numeric(14,2);
  v_event_type text;
  v_response jsonb := '{}'::jsonb;
  v_reason text;
  v_device_id text;
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key requerido.';
  end if;
  if p_command not in ('create_finance_event', 'reverse_finance_event') then
    raise exception 'Comando financiero no soportado: %', p_command;
  end if;

  v_admin := public.app_require_admin(p_session_token);
  v_request := public.app_uuid(trim(p_idempotency_key));
  v_reason := coalesce(
    nullif(trim(coalesce(p_payload->>'reason', '')), ''),
    nullif(trim(coalesce(p_payload->>'note', '')), ''),
    p_command
  );
  v_device_id := nullif(coalesce(p_payload->>'deviceId', current_setting('app.device_id', true)), '');

  perform pg_advisory_xact_lock(hashtextextended(trim(p_idempotency_key), 7));
  perform public.app_set_context(v_admin.id, v_admin.name, v_request, v_device_id, v_reason);

  select * into v_existing
  from public.audit_log
  where action = 'command' and idempotency_key = trim(p_idempotency_key);

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
  ) values (
    v_request, trim(p_idempotency_key), v_admin.id, v_admin.name, 'command',
    'admin_finance_command', v_request, public.app_redact_json(coalesce(p_payload, '{}'::jsonb)),
    array[p_command], v_reason, v_device_id, jsonb_build_object('command', p_command)
  );

  if p_command = 'create_finance_event' then
    v_event_type := p_payload->>'eventType';
    if v_event_type not in ('capital_contribution', 'expense', 'owner_withdrawal') then
      raise exception 'Tipo de movimiento financiero invalido.';
    end if;
    v_amount := round((p_payload->>'amount')::numeric, 2);
    if v_amount <= 0 then
      raise exception 'El valor debe ser mayor que cero.';
    end if;
    if nullif(trim(coalesce(p_payload->>'note', '')), '') is null then
      raise exception 'El concepto es obligatorio.';
    end if;

    insert into public.store_finance_events(
      event_type, amount, beneficiary, note, created_by, request_id
    ) values (
      v_event_type, v_amount, nullif(trim(coalesce(p_payload->>'beneficiary', '')), ''),
      trim(p_payload->>'note'), v_admin.id, v_request
    ) returning id into v_id;
    v_response := jsonb_build_object('id', v_id);
  else
    if nullif(trim(coalesce(p_payload->>'reason', '')), '') is null then
      raise exception 'El motivo del reverso es obligatorio.';
    end if;
    select * into v_original
    from public.store_finance_events
    where id = public.app_uuid(p_payload->>'eventId')
      and event_type in ('capital_contribution', 'expense', 'owner_withdrawal')
    for update;
    if not found then
      raise exception 'Movimiento financiero no encontrado.';
    end if;
    if exists (select 1 from public.store_finance_events where reversed_event_id = v_original.id) then
      raise exception 'El movimiento financiero ya fue reversado.';
    end if;

    insert into public.store_finance_events(
      event_type, amount, beneficiary, note, reversed_event_id, created_by, request_id
    ) values (
      v_original.event_type || '_reversal', v_original.amount, v_original.beneficiary,
      trim(p_payload->>'reason'), v_original.id, v_admin.id, v_request
    ) returning id into v_id;
    v_response := jsonb_build_object('id', v_id, 'reversedEventId', v_original.id);
  end if;

  update public.audit_log
  set metadata = jsonb_set(metadata, '{response}', v_response, true)
  where action = 'command' and idempotency_key = trim(p_idempotency_key);

  return v_response;
end;
$$;

revoke execute on function public.admin_get_finance_events(text) from public;
revoke execute on function public.admin_finance_command(text, text, text, jsonb) from public;
grant execute on function public.admin_get_finance_events(text) to anon, authenticated;
grant execute on function public.admin_finance_command(text, text, text, jsonb) to anon, authenticated;

commit;
