-- ======================================================================== Yearly team plans: 2 months free
-- Paying for a year (12 months) of a team plan costs 10 months' price, the same as Plus, staff licences and
-- White-label. Monthly stays the same.

-- Online checkout for a team plan: 12 months costs 10.
CREATE OR REPLACE FUNCTION public.billing_start(p_org uuid, p_plan text, p_months integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.plans;
  v_id uuid;
  v_amount numeric;
begin
  if p_plan like 'addon:%' then return private.addon_payment_start(p_org, p_plan); end if;
  if private.member_role(p_org) is distinct from 'owner' then
    raise exception 'Only the workspace owner can change the plan.' using errcode = '42501';
  end if;
  select * into v_plan from public.plans where id = p_plan;
  if v_plan.id is null or coalesce(v_plan.price_php_monthly, 0) <= 0 then
    raise exception 'That plan is not available for online payment yet.' using errcode = 'P0001';
  end if;
  if p_months not between 1 and 12 then raise exception 'Choose between 1 and 12 months.' using errcode = '22023'; end if;
  -- A year (12 months) costs 10 months: 2 months free.
  v_amount := v_plan.price_php_monthly * case when p_months = 12 then 10 else p_months end;
  insert into public.payments (org_id, plan_id, months, amount_php, created_by)
  values (p_org, p_plan, p_months, v_amount, auth.uid()) returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'amount_php', v_amount,
    'plan_name', v_plan.name, 'months', p_months, 'months_free', case when p_months = 12 then 2 else 0 end,
    'org_name', (select name from public.orgs where id = p_org),
    'email', (select email from public.profiles where id = auth.uid()));
end $function$;

insert into private.features (name) values ('yearly') on conflict do nothing;
