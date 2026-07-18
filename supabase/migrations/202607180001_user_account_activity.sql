begin;

create or replace function public.get_user_account_activity(
  p_session_token text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users%rowtype;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  v_user := public.app_current_user(p_session_token);
  if v_user.role <> 'user' then
    raise exception 'Actividad de cuenta disponible solo para usuarios.';
  end if;

  return jsonb_build_object(
    'accounts', case
      when v_user.account_id is null then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'status', a.status,
          'createdAt', a.created_at,
          'updatedAt', a.updated_at,
          'version', a.version
        ))
        from public.accounts a
        where a.id = v_user.account_id
      ), '[]'::jsonb)
    end,

    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'accountId', u.account_id,
        'name', u.name,
        'role', u.role,
        'status', u.status,
        'createdAt', u.created_at,
        'updatedAt', u.updated_at,
        'version', u.version
      ) order by u.name, u.id)
      from public.app_users u
      where u.role = 'user'
        and u.status = 'active'
        and (
          (v_user.account_id is not null and u.account_id = v_user.account_id)
          or
          (v_user.account_id is null and u.id = v_user.id)
        )
    ), '[]'::jsonb),

    'consumptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', scoped.id,
        'clientOperationId', scoped.client_operation_id,
        'accountId', scoped.account_id,
        'userId', scoped.user_id,
        'deviceId', scoped.device_id,
        'status', scoped.status,
        'total', scoped.total,
        'createdAt', scoped.created_at,
        'voidedAt', scoped.voided_at,
        'voidedBy', scoped.voided_by,
        'voidReason', scoped.void_reason
      ) order by scoped.created_at desc, scoped.id desc)
      from (
        select c.*
        from public.consumptions c
        where (
          (v_user.account_id is not null and c.account_id = v_user.account_id)
          or
          (v_user.account_id is null and c.user_id = v_user.id)
        )
        order by c.created_at desc, c.id desc
        limit v_limit
      ) scoped
    ), '[]'::jsonb),

    'consumptionItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ci.id,
        'consumptionId', ci.consumption_id,
        'productId', ci.product_id,
        'productName', ci.product_name,
        'quantity', ci.quantity,
        'unitPrice', ci.unit_price,
        'total', ci.total,
        'createdAt', ci.created_at
      ) order by ci.created_at desc, ci.id desc)
      from public.consumption_items ci
      where ci.consumption_id in (
        select scoped.id
        from (
          select c.id, c.created_at
          from public.consumptions c
          where (
            (v_user.account_id is not null and c.account_id = v_user.account_id)
            or
            (v_user.account_id is null and c.user_id = v_user.id)
          )
          order by c.created_at desc, c.id desc
          limit v_limit
        ) scoped
      )
    ), '[]'::jsonb),

    'financialMovements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', scoped.id,
        'movementType', scoped.movement_type,
        'accountId', scoped.account_id,
        'scope', scoped.scope,
        'userId', scoped.user_id,
        'paidByUserId', scoped.paid_by_user_id,
        'amount', scoped.amount,
        'reversedMovementId', scoped.reversed_movement_id,
        'note', scoped.note,
        'requestId', scoped.request_id,
        'createdAt', scoped.created_at,
        'unappliedAmount', case
          when scoped.movement_type in ('payment', 'payment_reversal')
            then scoped.amount - coalesce(scoped.applied_amount, 0)
          else 0
        end
      ) order by scoped.created_at desc, scoped.id desc)
      from (
        select
          fm.*,
          (
            select coalesce(sum(pa.amount), 0)::numeric(14,2)
            from public.payment_applications pa
            where pa.financial_movement_id = fm.id
          ) as applied_amount
        from public.financial_movements fm
        where fm.movement_type in ('payment', 'payment_reversal')
          and (
            (v_user.account_id is not null and fm.account_id = v_user.account_id)
            or
            (
              v_user.account_id is null
              and (fm.user_id = v_user.id or fm.paid_by_user_id = v_user.id)
            )
          )
        order by fm.created_at desc, fm.id desc
        limit v_limit
      ) scoped
    ), '[]'::jsonb),

    'paymentApplications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pa.id,
        'financialMovementId', pa.financial_movement_id,
        'consumptionId', pa.consumption_id,
        'accountId', pa.account_id,
        'userId', pa.user_id,
        'amount', pa.amount,
        'reversedApplicationId', pa.reversed_application_id,
        'createdAt', pa.created_at
      ) order by pa.created_at desc, pa.id desc)
      from public.payment_applications pa
      where pa.consumption_id in (
        select scoped.id
        from (
          select c.id, c.created_at
          from public.consumptions c
          where (
            (v_user.account_id is not null and c.account_id = v_user.account_id)
            or
            (v_user.account_id is null and c.user_id = v_user.id)
          )
          order by c.created_at desc, c.id desc
          limit v_limit
        ) scoped
      )
    ), '[]'::jsonb),

    'userBalances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', ub.user_id,
        'accountId', ub.account_id,
        'consumed', ub.consumed,
        'paid', ub.paid,
        'adjustments', ub.adjustments,
        'balance', ub.balance,
        'unappliedCredit', ub.unapplied_credit
      ) order by ub.user_id)
      from public.user_balances ub
      where (
        (v_user.account_id is not null and ub.account_id = v_user.account_id)
        or
        (v_user.account_id is null and ub.user_id = v_user.id)
      )
    ), '[]'::jsonb),

    'accountBalances', case
      when v_user.account_id is null then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'accountId', ab.account_id,
          'consumed', ab.consumed,
          'paid', ab.paid,
          'adjustments', ab.adjustments,
          'balance', ab.balance,
          'unappliedCredit', ab.unapplied_credit,
          'users', coalesce((
            select jsonb_agg(jsonb_build_object(
              'userId', ub.user_id,
              'accountId', ub.account_id,
              'consumed', ub.consumed,
              'paid', ub.paid,
              'adjustments', ub.adjustments,
              'balance', ub.balance,
              'unappliedCredit', ub.unapplied_credit
            ) order by ub.user_id)
            from public.user_balances ub
            where ub.account_id = ab.account_id
          ), '[]'::jsonb)
        ))
        from public.account_balances ab
        where ab.account_id = v_user.account_id
      ), '[]'::jsonb)
    end,

    'consumptionPaymentStatuses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'consumptionId', cps.consumption_id,
        'userId', cps.user_id,
        'accountId', cps.account_id,
        'total', cps.total_due,
        'paid', cps.applied_amount,
        'openAmount', cps.open_amount,
        'status', cps.payment_status
      ) order by scoped.created_at desc, cps.consumption_id desc)
      from public.consumption_payment_status cps
      join (
        select c.id, c.created_at
        from public.consumptions c
        where (
          (v_user.account_id is not null and c.account_id = v_user.account_id)
          or
          (v_user.account_id is null and c.user_id = v_user.id)
        )
        order by c.created_at desc, c.id desc
        limit v_limit
      ) scoped on scoped.id = cps.consumption_id
    ), '[]'::jsonb),

    'generatedAt', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_user_account_activity(text, integer) from public;
grant execute on function public.get_user_account_activity(text, integer) to anon, authenticated;

commit;
