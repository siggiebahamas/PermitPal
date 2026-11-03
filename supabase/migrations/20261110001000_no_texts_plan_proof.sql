-- Database file 24: (1) text reminders are off for now: email, in-app and phone alerts carry every reminder.
-- (2) Paying for a team plan works like every other payment: the customer says how they paid (reference number
-- and/or a screenshot), sees "We're checking your payment" right away, and the same row turns "Confirmed" when
-- staff record it. Every payment is then listed in Settings > Plan with a printable acknowledgment.

-- ======================================================================== 1) no text reminders
delete from private.features where name = 'sms';
update public.plans set features = array_remove(array_remove(features, 'Text message reminders'), 'SMS and WhatsApp reminders')
 where features && array['Text message reminders', 'SMS and WhatsApp reminders'];
update public.load_products set active = false where code like 'texts\_%';

-- ======================================================================== 2) proof of payment for team plans
alter table public.payments
  add column if not exists proof_path text check (proof_path is null or length(proof_path) <= 400),
  add column if not exists proof_name text check (proof_name is null or length(proof_name) <= 255),
  add column if not exists reported_at timestamptz;

-- The customer: "I've paid". Records a payment waiting to be checked (never turns the plan on by itself).
create or replace function public.plan_payment_report(p_org uuid, p_plan text, p_months int, p_method text, p_ref text,
  p_proof_path text default null, p_proof_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_plan public.plans; v_id uuid; v_amount numeric;
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can pay for the plan.' using errcode = '42501'; end if;
  select * into v_plan from public.plans where id = p_plan and available;
  if v_plan.id is null or coalesce(v_plan.price_php_monthly, 0) <= 0 then raise exception 'That plan is not available.' using errcode = 'P0001'; end if;
  if p_months is null or p_months not in (1, 12) then raise exception 'Choose 1 month or 12 months.' using errcode = '22023'; end if;
  if coalesce(p_method, '') not in ('gcash','maya','bank_transfer','other') then raise exception 'Choose how you paid.' using errcode = '22023'; end if;
  if coalesce(btrim(p_ref), '') = '' and p_proof_path is null then raise exception 'Add the reference number or a screenshot of the payment.' using errcode = '22023'; end if;
  if length(coalesce(p_ref, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  if p_proof_path is not null and p_proof_path not like p_org::text || '/payments/%' then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  if (select count(*) from public.payments where org_id = p_org and status = 'pending' and provider = 'manual' and reported_at > now() - interval '7 days') >= 3 then
    raise exception 'We are still checking your earlier payments. We will confirm them within 1 business day.' using errcode = 'P0001';
  end if;
  v_amount := v_plan.price_php_monthly * case when p_months = 12 then 10 else 1 end; -- yearly: pay 10 months, get 12
  insert into public.payments (org_id, plan_id, months, amount_php, provider, status, created_by, method, reference, proof_path, proof_name, reported_at)
  values (p_org, p_plan, p_months, v_amount, 'manual', 'pending', auth.uid(), p_method, nullif(btrim(p_ref), ''), p_proof_path, left(p_proof_name, 255), now())
  returning id into v_id;
  perform private.notify_admins('Plan payment to confirm: ' || v_plan.name || ' for ' || (select name from public.orgs where id = p_org),
    private.peso(v_amount) || ' for ' || p_months || case when p_months = 1 then ' month' else ' months' end || ' via ' || replace(p_method, '_', ' ')
      || coalesce(', ref ' || nullif(btrim(p_ref), ''), '') || case when p_proof_path is not null then ', screenshot attached' else '' end,
    'planpay:' || v_id, true);
  return v_id;
end $$;
revoke all on function public.plan_payment_report(uuid, text, int, text, text, text, text) from public, anon;
grant execute on function public.plan_payment_report(uuid, text, int, text, text, text, text) to authenticated;

-- Staff record a plan payment: if the customer already reported it, that same row is confirmed (so their
-- "Checking" turns into "Confirmed"); otherwise a new row is added, as before.
create or replace function public.admin_record_plan_payment(p_org uuid, p_plan text, p_months int, p_amount numeric,
  p_method text, p_ref text default null, p_invoice_no text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org public.orgs; v_plan public.plans; v_from timestamptz; v_id uuid; v_until timestamptz;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_org from public.orgs where id = p_org for update;
  if v_org.id is null then raise exception 'Workspace not found.' using errcode = 'P0002'; end if;
  select * into v_plan from public.plans where id = p_plan;
  if v_plan.id is null or coalesce(v_plan.price_php_monthly, 0) <= 0 then raise exception 'Choose a paid plan.' using errcode = '22023'; end if;
  if p_months is null or p_months not between 1 and 12 then raise exception 'Choose 1 to 12 months.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount received.' using errcode = '22023'; end if;
  select id into v_id from public.payments where org_id = p_org and plan_id = p_plan and status = 'pending' and provider = 'manual'
    and addon_invoice_id is null and load_topup_id is null and request_id is null order by reported_at desc nulls last limit 1 for update;
  if v_id is not null then
    update public.payments set months = p_months, amount_php = round(p_amount, 2), status = 'paid', paid_at = now(),
      method = coalesce(nullif(btrim(p_method), ''), method), reference = coalesce(nullif(btrim(p_ref), ''), reference),
      bir_invoice_no = coalesce(nullif(btrim(p_invoice_no), ''), bir_invoice_no) where id = v_id;
  else
    insert into public.payments (org_id, plan_id, months, amount_php, provider, status, paid_at, created_by, method, reference, bir_invoice_no)
    values (p_org, p_plan, p_months, round(p_amount, 2), 'manual', 'paid', now(), auth.uid(), nullif(btrim(p_method), ''), nullif(btrim(p_ref), ''), nullif(btrim(p_invoice_no), ''))
    returning id into v_id;
  end if;
  v_from := case when v_org.plan_id = p_plan and v_org.plan_expires_at > now() then v_org.plan_expires_at else now() end;
  v_until := v_from + make_interval(months => p_months);
  update public.orgs set plan_id = p_plan, plan_expires_at = v_until where id = p_org;
  perform private.notify_owners(p_org, 'Payment received - thank you!',
    'Your ' || v_plan.name || ' plan is active until ' || private.fmt_date(private.ph_day(v_until)) || '. Your acknowledgment is in Settings > Plan.', '#/settings/billing', 'planpaid:' || v_id, true, false);
  return v_id;
end $$;

insert into private.features (name) values ('payproof') on conflict do nothing;
