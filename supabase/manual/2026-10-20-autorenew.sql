-- PermitPal: Year-round care without a monthly fee ("Pay per renewal"), next to the All-in plan.
-- All or nothing: if anything fails, nothing is changed.
--
-- Order matters: run 2026-10-17-new-features.sql, then 2026-10-19-revenue.sql, then this file, once.
-- The new choice appears on the website by itself once this has run.
begin;

do $$ declare v_rev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'revenue'), exists (select 1 from private.features where name = 'autorenew')$q$ into v_rev, v_done;
  end if;
  if not v_rev then raise exception 'Run supabase/manual/2026-10-19-revenue.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261020001000_autorenew.sql
-- Year-round care without a monthly fee. Customers asked the fair question: why pay every month when a
-- permit is renewed once a year? Now there are two ways to pay, and tracking stays free either way:
--   Pay per renewal  no monthly fee. PermitPal still starts each covered renewal ~60 days early on its own;
--                    the customer pays that renewal's usual fixed fee (plus government fees) when it's done.
--   All-in plan      one fixed amount a month (or a year): every covered renewal's fee included, plus the
--                    on-time guarantee and a yearly pre-inspection visit. It's the year's renewal fees spread
--                    evenly, not a fee for tracking.
-- The two existing tiers become these two (prices are only changed if they're still at their first values).

alter table public.care_plans drop constraint if exists care_plans_billing_check;
alter table public.care_plans add constraint care_plans_billing_check check (billing in ('monthly','yearly','per_renewal'));

update public.care_tiers set name = 'Pay per renewal', monthly_php = 0, yearly_php = 0, guarantee = false, guarantee_cap_php = 0, walkthroughs = 0,
  includes = array['No monthly fee','We start every covered renewal about 2 months before it''s due, on our own','You pay each renewal''s fixed fee only when we do it','Government fees at cost, with official receipts']
  where code = 'branch_care' and monthly_php = 1200;
update public.care_tiers set name = 'All-in plan', monthly_php = 1200, yearly_php = 12000, guarantee = true, guarantee_cap_php = 10000, walkthroughs = 1,
  includes = array['Every covered renewal included: no per-renewal fees','On-time guarantee: if we miss a deadline, we pay the late penalty (up to ₱10,000 per permit)','One fire or sanitary pre-inspection visit a year','One fixed amount, so January doesn''t hit you all at once']
  where code = 'branch_plus' and monthly_php = 1800;
update public.care_tiers set name = 'Pay per renewal', monthly_php = 0, yearly_php = 0, guarantee = false, guarantee_cap_php = 0, walkthroughs = 0,
  includes = array['No monthly fee','Registration, CTPL, emission test and inspection started on time','You pay each renewal''s fixed fee only when we do it','The new OR/CR saved for you']
  where code = 'vehicle_care' and monthly_php = 250;
update public.care_tiers set name = 'All-in plan', monthly_php = 250, yearly_php = 2500, guarantee = true, guarantee_cap_php = 3000, walkthroughs = 0,
  includes = array['Every covered renewal included: no per-renewal fees','On-time guarantee: if we miss the deadline, we pay the late penalty (up to ₱3,000)','One fixed amount a month']
  where code = 'vehicle_plus' and monthly_php = 350;

-- Starting care: "per_renewal" plans are on straight away and have no bill.
create or replace function public.start_care(p_org uuid, p_items jsonb, p_billing text, p_consent boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb; v_tier public.care_tiers; v_plan uuid; v_lines jsonb := '[]'::jsonb; v_total numeric := 0; v_label text;
  v_inv uuid; v_today date := private.today_ph(); v_end date; v_price numeric; v_id uuid; v_l record; v_v record;
  v_org text; v_no text; v_n int := 0;
begin
  if p_org is null or p_org not in (select private.my_owner_org_ids()) then
    raise exception 'Only the workspace owner can start a paid plan.' using errcode = '42501';
  end if;
  if not coalesce(p_consent, false) then raise exception 'Please tick the box to confirm.' using errcode = '22023'; end if;
  if coalesce(p_billing, '') not in ('monthly','yearly','per_renewal') then raise exception 'Choose how you want to pay.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one branch or vehicle.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'Choose up to 50 at a time.' using errcode = '22023'; end if;
  if (select count(*) from public.care_invoices where org_id = p_org and status = 'due' and first) >= 3 then
    raise exception 'You have 3 sign-up bills waiting for payment. Pay or cancel those first.' using errcode = 'P0001';
  end if;
  v_end := case p_billing when 'monthly' then (v_today + interval '1 month')::date - 1 else (v_today + interval '1 year')::date - 1 end;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_tier from public.care_tiers where code = v_item ->> 'tier' and active;
    if v_tier.code is null then raise exception 'That care plan is not available.' using errcode = '22023'; end if;
    -- Pay per renewal has no monthly fee; the All-in plan is paid monthly or yearly.
    if p_billing = 'per_renewal' and (v_tier.monthly_php > 0 or v_tier.guarantee) then
      raise exception '% has a monthly fee. Choose monthly or yearly for it.', v_tier.name using errcode = '22023';
    end if;
    if p_billing <> 'per_renewal' and v_tier.monthly_php = 0 then
      raise exception '% has no monthly fee. Choose "Pay per renewal" for it.', v_tier.name using errcode = '22023';
    end if;
    begin v_id := (v_item ->> 'id')::uuid; exception when others then raise exception 'That branch or vehicle was not found.' using errcode = 'P0002'; end;
    v_price := case p_billing when 'monthly' then v_tier.monthly_php when 'yearly' then v_tier.yearly_php else 0 end;
    if v_item ->> 'kind' = 'location' and v_tier.subject = 'branch' then
      select l.id, l.business_id, l.name, l.city, b.name as bname into v_l
        from public.business_locations l join public.businesses b on b.id = l.business_id
        where l.id = v_id and l.org_id = p_org and l.deleted_at is null and b.deleted_at is null;
      if v_l.id is null then raise exception 'That branch was not found.' using errcode = 'P0002'; end if;
      v_label := v_l.bname || ' · ' || v_l.name || coalesce(' (' || nullif(v_l.city, '') || ')', '');
      if exists (select 1 from public.care_plans where location_id = v_id and status <> 'cancelled') then
        raise exception '% already has a care plan.', v_label using errcode = 'P0001';
      end if;
      insert into public.care_plans (org_id, tier, location_id, business_id, label, billing, price_php, consented_at)
      values (p_org, v_tier.code, v_id, v_l.business_id, v_label, p_billing, v_price, now()) returning id into v_plan;
    elsif v_item ->> 'kind' = 'vehicle' and v_tier.subject = 'vehicle' then
      select v.id, v.make_model, v.plate_no, v.business_id into v_v from public.vehicles v where v.id = v_id and v.org_id = p_org and v.deleted_at is null;
      if v_v.id is null then raise exception 'That vehicle was not found.' using errcode = 'P0002'; end if;
      v_label := v_v.make_model || case when coalesce(v_v.plate_no, '') <> '' then ' · ' || v_v.plate_no else '' end;
      if exists (select 1 from public.care_plans where vehicle_id = v_id and status <> 'cancelled') then
        raise exception '% already has a care plan.', v_label using errcode = 'P0001';
      end if;
      insert into public.care_plans (org_id, tier, vehicle_id, business_id, label, billing, price_php, consented_at)
      values (p_org, v_tier.code, v_id, v_v.business_id, v_label, p_billing, v_price, now()) returning id into v_plan;
    else
      raise exception 'That plan doesn''t match what you chose.' using errcode = '22023';
    end if;
    if p_billing = 'per_renewal' then
      update public.care_plans set status = 'active', started_on = v_today where id = v_plan;
    end if;
    v_lines := v_lines || jsonb_build_object('plan_id', v_plan, 'label', v_label, 'tier', v_tier.name, 'amount', v_price);
    v_total := v_total + v_price;
    v_n := v_n + 1;
  end loop;
  select name into v_org from public.orgs where id = p_org;
  -- Pay per renewal: on straight away, nothing to pay now. Each renewal is quoted and paid when we do it.
  if p_billing = 'per_renewal' then
    perform private.notify_admins('Year-round care started (pay per renewal): ' || v_org, v_n || ' branch/vehicle(s), no monthly fee. Quote each renewal at its usual price when it starts.',
      'autorenew:' || p_org || ':' || extract(epoch from now())::bigint, false);
    return null;
  end if;
  v_no := private.next_no('C');
  insert into public.care_invoices (org_id, number, first, period_start, period_end, lines, amount_php, due_on)
  values (p_org, v_no, true, v_today, v_end, v_lines, v_total, v_today + 3) returning id into v_inv;
  perform private.notify_admins('New Year-round care sign-up: ' || v_org,
    v_n || ' branch/vehicle plan(s), ' || private.peso(v_total) || ' per ' || case p_billing when 'monthly' then 'month' else 'year' end ||
    '. Bill ' || v_no || ' is waiting for payment.', 'carenew:' || v_inv, true);
  return v_inv;
end $$;

-- The daily job starts renewals for pay-per-renewal plans too (they have no paid-up date).
create or replace function private.care_daily() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.today_ph(); v_n int := 0; v record; v_g record; v_lines jsonb; v_total numeric; v_inv uuid; v_no text; v_end date;
begin
  -- 1) Plans set to end, and plans whose branch or vehicle was deleted.
  for v in select p.* from public.care_plans p where p.status in ('active','paused') and p.cancel_at is not null and p.cancel_at <= v_today loop
    update public.care_plans set status = 'cancelled' where id = v.id;
    perform private.drop_plan_from_unpaid(v.id);
    perform private.notify_owners(v.org_id, 'Year-round care ended: ' || v.label, 'As you asked. Your permits stay in PermitPal and reminders keep coming.',
      '#/care', 'careend:' || v.id, true, false);
  end loop;
  for v in select p.* from public.care_plans p
           left join public.business_locations l on l.id = p.location_id left join public.businesses b on b.id = l.business_id
           left join public.vehicles ve on ve.id = p.vehicle_id
           where p.status <> 'cancelled' and (l.deleted_at is not null or b.deleted_at is not null or ve.deleted_at is not null) loop
    update public.care_plans set status = 'cancelled', cancel_at = v_today, ended_reason = 'The branch or vehicle was deleted.' where id = v.id;
    perform private.drop_plan_from_unpaid(v.id);
    perform private.notify_owners(v.org_id, 'Year-round care ended: ' || v.label, 'The branch or vehicle was deleted, so its plan ended. Restore it from Trash and start a new plan if that was a mistake.',
      '#/care', 'caredel:' || v.id, true, false);
  end loop;

  -- 2) Next bills, 7 days before the paid period ends (one bill per workspace per end date).
  for v_g in select p.org_id, p.billing, p.paid_through, jsonb_agg(jsonb_build_object('plan_id', p.id, 'label', p.label, 'tier', t.name, 'amount', p.price_php) order by p.label) as lines,
                    sum(p.price_php) as total
             from public.care_plans p join public.care_tiers t on t.code = p.tier
             where p.status in ('active','paused') and p.cancel_at is null and p.paid_through is not null and p.paid_through - v_today <= 7
               and not exists (select 1 from public.care_invoices i where i.status <> 'void' and i.period_start = p.paid_through + 1
                               and i.lines @> jsonb_build_array(jsonb_build_object('plan_id', p.id)))
             group by p.org_id, p.billing, p.paid_through loop
    v_end := case v_g.billing when 'monthly' then (v_g.paid_through + 1 + interval '1 month')::date - 1 else (v_g.paid_through + 1 + interval '1 year')::date - 1 end;
    v_no := private.next_no('C');
    insert into public.care_invoices (org_id, number, period_start, period_end, lines, amount_php, due_on)
    values (v_g.org_id, v_no, v_g.paid_through + 1, v_end, v_g.lines, v_g.total, greatest(v_g.paid_through, v_today)) returning id into v_inv;
    perform private.notify_owners(v_g.org_id, 'Your Year-round care bill: ' || private.peso(v_g.total),
      'Bill ' || v_no || ' covers ' || private.fmt_date(v_g.paid_through + 1) || ' to ' || private.fmt_date(v_end) || '. Please pay by ' || private.fmt_date(greatest(v_g.paid_through, v_today)) || '.',
      '#/care', 'carebill:' || v_inv, true, true);
    v_n := v_n + 1;
  end loop;

  -- 3) Overdue reminders (the day after, then a week after).
  for v in select * from public.care_invoices where status = 'due' and due_on < v_today and (v_today - due_on) in (1, 7) loop
    perform private.notify_owners(v.org_id, 'Care bill ' || v.number || ' is overdue',
      private.peso(v.amount_php) || ' was due ' || private.fmt_date(v.due_on) || '. After 7 days we pause renewals and the on-time guarantee until it''s paid.',
      '#/care', 'careover:' || v.id || ':' || (v_today - v.due_on), true, true);
  end loop;

  -- 4) Not paid 7 days after coverage ran out: pause (no new renewals, no guarantee) until paid.
  for v in select * from public.care_plans where status = 'active' and paid_through is not null and paid_through < v_today - 7 loop
    update public.care_plans set status = 'paused' where id = v.id;
    perform private.notify_owners(v.org_id, 'Year-round care paused: ' || v.label,
      'The bill isn''t paid yet, so we''ve paused new renewals and the on-time guarantee. Pay the bill and everything starts again the same day.',
      '#/care', 'carepause:' || v.id || ':' || v.paid_through, true, true);
  end loop;

  -- 5) Start covered renewals: 60 days ahead for business permits, 45 for vehicles, and anything already overdue.
  for v in select * from (select distinct on (rs.id) rs.id, rs.org_id, rs.type_code, rs.subject, rs.expires_on, p.id as plan_id, p.consented_at, p.billing,
             (select pr.email from public.org_members m join public.profiles pr on pr.id = m.user_id
              where m.org_id = p.org_id and m.role = 'owner' order by m.created_at limit 1) as owner_email
           from public.care_plans p
           cross join lateral private.care_covered(p.id) c
           join public.requirement_status rs on rs.id = c.requirement_id
           where p.status = 'active' and (p.billing = 'per_renewal' or p.paid_through >= v_today) and rs.expires and rs.expires_on is not null
             and rs.expires_on <= v_today + case when rs.subject = 'vehicle' then 45 else 60 end
             and rs.open_request_id is null and rs.renewal_started_at is null
             and private.renewal_service_for(rs.type_code) is not null
             -- once per expiry date: if the customer cancelled the one we started, we don't start it again
             and not exists (select 1 from public.assistance_requests a where a.requirement_id = rs.id and a.care_plan_id is not null
                              and a.created_by is null and a.due_on = rs.expires_on)
           order by rs.id, p.created_at) q
           -- the main permit first: the LTO registration before the emission test it includes
           order by coalesce(array_position((select s.type_codes from public.services s where s.code = private.renewal_service_for(q.type_code)), q.type_code), 99), q.expires_on loop
    -- one job per branch or vehicle per service: the LTO renewal already includes the emission test and inspection
    continue when exists (select 1 from public.assistance_requests a where a.care_plan_id = v.plan_id and a.requirement_id <> v.id
      and a.status not in ('completed','cancelled') and a.service_code = private.renewal_service_for(v.type_code));
    insert into public.assistance_requests (org_id, service_code, requirement_id, requirement_name, subject_label, notes, rush,
      contact_method, contact_value, docs_status, kind, consented_at, care_plan_id)
    values (v.org_id, private.renewal_service_for(v.type_code), v.id, '-', '-', 'Started by your Year-round care plan (' || case when v.billing = 'per_renewal' then 'pay per renewal' else 'All-in plan' end || ').', false,
      'email', v.owner_email, 'not_sure', 'renew', v.consented_at, v.plan_id);
    v_n := v_n + 1;
  end loop;

  -- 6) Temporary staff access never outlives 30 days.
  for v in select * from private.staff_memberships where ended_at is null and joined_at < now() - interval '30 days' loop
    delete from public.org_members where org_id = v.org_id and user_id = v.user_id and role = 'member';
    update private.staff_memberships set ended_at = now() where org_id = v.org_id and user_id = v.user_id and request_id = v.request_id;
  end loop;
  return v_n;
end $$;

-- The "we've started your renewal" notice says what the customer will be asked to pay.
create or replace function private.assistance_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org_name text;
  v_requester text;
  v_contact text;
  v_body text;
  v_m record;
begin
  select name into v_org_name from public.orgs where id = new.org_id;

  if tg_op = 'INSERT' then
    if new.care_plan_id is not null and new.created_by is null then
      insert into public.request_events (request_id, org_id, actor_id, by_staff, kind, message)
      values (new.id, new.org_id, null, true, 'created', 'Started automatically by your Year-round care plan.');
      for v_m in select user_id from public.org_members where org_id = new.org_id and role in ('owner','admin') loop
        perform private.notify(v_m.user_id, new.org_id, 'help', 'We''ve started your ' || new.requirement_name || ' renewal',
          new.subject_label || case when (select p.billing from public.care_plans p where p.id = new.care_plan_id) = 'per_renewal'
            then '. You''re on pay per renewal: we''ll send you the exact price (our usual fee plus the government fees) to approve, then take care of the rest.'
            else '. Covered by your Year-round care plan: we''ll send you the government fees to approve, then take care of the rest.' end,
          '#/services/orders/' || new.id, new.requirement_id, 'carestart:' || new.id || ':' || v_m.user_id, true);
      end loop;
      perform private.notify_admins('Care renewal to quote: ' || new.requirement_name, v_org_name || ' - ' || new.subject_label ||
        case when new.due_on is not null then ', due ' || private.fmt_date(new.due_on) else '' end, 'carenew:' || new.id, false);
      return null;
    end if;
    insert into public.request_events (request_id, org_id, actor_id, by_staff, kind, message)
    values (new.id, new.org_id, new.created_by, false, 'created', coalesce(nullif(btrim(new.notes), ''), 'Request sent'));
    if coalesce(current_setting('pp.bulk', true), 'off') = 'on' then return null; end if;
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), p.email), p.email into v_requester, v_contact
      from public.profiles p where p.id = new.created_by;
    v_body := v_org_name || ' - ' || new.requirement_name || ' for ' || new.subject_label ||
              case when new.due_on is not null then ', due ' || private.fmt_date(new.due_on) else '' end ||
              case when new.rush then ' - RUSH' else '' end ||
              case when new.care_plan_id is not null then ' - included in their care plan' else '' end ||
              '. Requested by ' || coalesce(v_requester, '-') || ' (' || coalesce(v_contact, '-') || '), contact via ' ||
              new.contact_method || coalesce(': ' || new.contact_value, '') || '. Notes: ' || coalesce(new.notes, '-');
    perform private.notify_admins('New request: ' || new.requirement_name, v_body, 'ordernew:' || new.id, true);
    if new.created_by is not null then
      perform private.notify(new.created_by, new.org_id, 'help', 'We received your request',
        new.requirement_name || ' for ' || new.subject_label || '. You''ll get an exact quote before anything starts.',
        '#/services/orders/' || new.id, new.requirement_id, 'orderack:' || new.id, true);
    end if;
    return null;
  end if;

  if new.status is distinct from old.status then
    if new.created_by is not null and (auth.uid() is null or private.is_platform_admin()) then
      perform private.notify(new.created_by, new.org_id, 'help',
        new.requirement_name || ': ' || private.help_status_label(new.status),
        new.subject_label || case when new.admin_note is not null then '. ' || new.admin_note else '' end,
        '#/services/orders/' || new.id, new.requirement_id,
        'orderupd:' || new.id || ':' || new.status || ':' || extract(epoch from new.updated_at)::bigint, true);
    elsif new.created_by is null and new.care_plan_id is not null and (auth.uid() is null or private.is_platform_admin()) then
      for v_m in select user_id from public.org_members where org_id = new.org_id and role in ('owner','admin') loop
        perform private.notify(v_m.user_id, new.org_id, 'help', new.requirement_name || ': ' || private.help_status_label(new.status),
          new.subject_label || case when new.admin_note is not null then '. ' || new.admin_note else '' end,
          '#/services/orders/' || new.id, new.requirement_id,
          'orderupd:' || new.id || ':' || new.status || ':' || extract(epoch from new.updated_at)::bigint || ':' || v_m.user_id, true);
      end loop;
    end if;
    if new.status = 'cancelled' and auth.uid() is not null and not private.is_platform_admin() then
      perform private.notify_admins('Request cancelled: ' || new.requirement_name, v_org_name || ' - ' || new.subject_label,
        'ordercancel:' || new.id, false);
      insert into public.request_events (request_id, org_id, by_staff, kind, message)
      values (new.id, new.org_id, false, 'cancelled', 'Cancelled by the customer');
    end if;
  end if;
  return null;
end $$;

-- The guarantee is part of the All-in plan.
create or replace function public.file_guarantee_claim(p_plan uuid, p_requirement uuid, p_penalty numeric, p_note text,
  p_receipt_path text, p_receipt_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_p public.care_plans; v_t public.care_tiers; v_lapse date; v_today date := private.today_ph(); v_name text; v_id uuid; v_org text;
begin
  select * into v_p from public.care_plans where id = p_plan;
  if v_p.id is null or v_p.org_id not in (select private.my_writable_org_ids()) then raise exception 'Plan not found.' using errcode = '42501'; end if;
  select * into v_t from public.care_tiers where code = v_p.tier;
  if not v_t.guarantee then raise exception 'The on-time guarantee comes with the All-in plan. This plan is %.', v_t.name using errcode = 'P0001'; end if;
  if v_p.status = 'pending' or v_p.started_on is null then raise exception 'This plan hasn''t started yet.' using errcode = 'P0001'; end if;
  if p_requirement is null or p_requirement not in (select requirement_id from private.care_covered(p_plan)) then
    raise exception 'That permit isn''t covered by this plan.' using errcode = 'P0001';
  end if;
  select max(c.expires_on) into v_lapse from public.requirement_cycles c
    where c.requirement_id = p_requirement and c.deleted_at is null and c.expires_on < v_today;
  if v_lapse is null then raise exception 'This permit hasn''t lapsed: there''s no past expiry date on file for it.' using errcode = 'P0001'; end if;
  if v_lapse < v_today - 90 then raise exception 'Claims must be made within 90 days of the permit''s expiry date (%).', private.fmt_date(v_lapse) using errcode = 'P0001'; end if;
  if v_p.started_on > v_lapse - 30 then
    raise exception 'The guarantee covers permits that were in your plan at least 30 days before they expired. This one expired %, % days after the plan started.',
      private.fmt_date(v_lapse), v_lapse - v_p.started_on using errcode = 'P0001';
  end if;
  if v_p.paid_through is null or v_p.paid_through < v_lapse then
    raise exception 'The plan wasn''t paid up on the expiry date (%), so the guarantee doesn''t apply.', private.fmt_date(v_lapse) using errcode = 'P0001';
  end if;
  if p_penalty is null or p_penalty <= 0 or p_penalty > 1000000 then raise exception 'Enter the penalty you paid, in pesos.' using errcode = '22023'; end if;
  if p_receipt_path is null or p_receipt_path not like v_p.org_id::text || '/care/%' then
    raise exception 'Attach the official receipt that shows the penalty.' using errcode = '22023';
  end if;
  if exists (select 1 from public.guarantee_claims where requirement_id = p_requirement and lapsed_on = v_lapse) then
    raise exception 'You already sent a claim for this permit''s % expiry.', private.fmt_date(v_lapse) using errcode = 'P0001';
  end if;
  select name into v_name from public.requirements where id = p_requirement;
  insert into public.guarantee_claims (org_id, plan_id, requirement_id, requirement_name, lapsed_on, penalty_php, note, receipt_path, receipt_name)
  values (v_p.org_id, p_plan, p_requirement, v_name, v_lapse, round(p_penalty, 2), nullif(btrim(p_note), ''), p_receipt_path, p_receipt_name)
  returning id into v_id;
  select name into v_org from public.orgs where id = v_p.org_id;
  perform private.notify_admins('Guarantee claim: ' || v_org, v_name || ' (' || v_p.label || ') expired ' || private.fmt_date(v_lapse) ||
    '. Penalty ' || private.peso(p_penalty) || '. Decide within 5 business days.', 'claim:' || v_id, true);
  return v_id;
end $$;

-- Auto-accept within the customer's pre-approved government fees, for both ways of paying.
create or replace function public.admin_quote_request(p_req uuid, p_service_fee numeric, p_gov_fees numeric, p_note text default null, p_rush_fee numeric default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_a public.assistance_requests; v_rush numeric := coalesce(p_rush_fee, 0); v_gov numeric := coalesce(p_gov_fees, 0);
  v_total numeric; v_pre numeric := 0; v_auto boolean := false;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_service_fee is null or p_service_fee < 0 or v_gov < 0 or v_rush < 0 then raise exception 'Enter valid amounts.' using errcode = '22023'; end if;
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if v_rush > 0 and not v_a.rush then raise exception 'The customer didn''t ask for this to be rushed. Leave the rush fee at 0.' using errcode = '22023'; end if;
  if v_a.status not in ('submitted','quoted','awaiting_customer') or v_a.payment_status in ('paid','waived','pending_verification') then
    raise exception 'This request can no longer be quoted.' using errcode = 'P0001';
  end if;
  v_total := p_service_fee + v_rush + v_gov;
  -- A renewal care started: accepted for the customer when the government fees are within what they
  -- pre-approved. On the All-in plan our fee is 0; on pay per renewal it's at most the service's listed price.
  if v_a.care_plan_id is not null and v_a.created_by is null and v_rush = 0
     and (p_service_fee = 0 or exists (select 1 from public.care_plans p where p.id = v_a.care_plan_id and p.billing = 'per_renewal')
          and p_service_fee <= coalesce((select s.price_from from public.services s where s.code = v_a.service_code), 0)) then
    select coalesce(o.care_gov_preapproval_php, 0) into v_pre from public.orgs o where o.id = v_a.org_id;
    v_auto := v_gov <= v_pre;
  end if;
  update public.assistance_requests set quote_service_fee = p_service_fee, quote_rush_fee = v_rush, quote_gov_fees = v_gov,
    quote_php = v_total, quote_note = nullif(btrim(p_note), ''), quoted_at = now(),
    accepted_at = case when v_auto then now() end,
    payment_status = case when v_auto and v_total = 0 then 'waived' when v_auto then 'awaiting_payment' else 'unpaid' end,
    status = case when v_auto and v_total = 0 then 'in_progress' when v_auto then 'awaiting_customer' else 'quoted' end,
    admin_note = case when v_auto and p_service_fee > 0 then 'Our usual fixed fee ' || private.peso(p_service_fee) || ' plus government fees ' || private.peso(v_gov) || ' (within what you pre-approved). Pay to start.'
                      when v_auto and v_total > 0 then 'Government fees ' || private.peso(v_gov) || ', within the amount you pre-approved. Pay to start.' end
  where id = p_req;
  perform private.order_event(p_req, 'quote', 'Quote: ' || private.peso(v_total) || ' (service fee ' || private.peso(p_service_fee) ||
    case when v_rush > 0 then ', rush fee ' || private.peso(v_rush) else '' end || ', government fees ' || private.peso(v_gov) || ')' ||
    coalesce('. ' || nullif(btrim(p_note), ''), ''));
  if v_auto then
    perform private.order_event(p_req, 'accepted', 'Accepted for you: the government fees are within the ' || private.peso(v_pre) || ' you pre-approved for care renewals.');
  end if;
end $$;

-- Money summary: plans that bring in a monthly amount, and pay-per-renewal plans counted apart.
create or replace function public.admin_money_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v jsonb;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'today', v_today,
    'goal', nullif(private.setting('money_goal'), '')::numeric,
    'ic_licence_no', coalesce(private.setting('ic_licence_no'), ''),
    'mrr_care', coalesce((select sum(case billing when 'monthly' then price_php else round(price_php / 12, 2) end) from public.care_plans
                          where status = 'active' and paid_through >= v_today and cancel_at is null), 0),
    'care_active', (select count(*) from public.care_plans where status = 'active' and billing <> 'per_renewal'),
    'care_autorenew', (select count(*) from public.care_plans where status = 'active' and billing = 'per_renewal'),
    'care_pending', (select count(*) from public.care_plans where status = 'pending'),
    'care_paused', (select count(*) from public.care_plans where status = 'paused'),
    'care_ending', (select count(*) from public.care_plans where status in ('active','paused') and cancel_at is not null),
    'mrr_plans', coalesce((select sum(pl.price_php_monthly) from public.orgs o join public.plans pl on pl.id = o.plan_id
                           where o.deleted_at is null and coalesce(pl.price_php_monthly, 0) > 0 and (o.plan_expires_at is null or o.plan_expires_at > now())), 0),
    'plans_paying', (select count(*) from public.orgs o join public.plans pl on pl.id = o.plan_id
                     where o.deleted_at is null and coalesce(pl.price_php_monthly, 0) > 0 and (o.plan_expires_at is null or o.plan_expires_at > now())),
    'held_gov', coalesce((select sum(coalesce(quote_gov_fees, 0)) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded')), 0)
              - coalesce((select sum(gov_fees_actual) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and gov_fees_actual is not null), 0)
              - coalesce((select sum(r.amount_php) from public.order_refunds r where r.kind = 'fee_difference'), 0)
              - coalesce((select sum(r.amount_php - least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)) from public.order_refunds r
                          join public.assistance_requests a on a.id = r.request_id where r.kind = 'full'), 0),
    'gov_unrecorded', (select count(*) from public.assistance_requests where status = 'completed' and paid_at is not null and coalesce(quote_gov_fees, 0) > 0 and gov_fees_actual is null),
    'quotes_to_send', (select count(*) from public.assistance_requests where status = 'submitted' and (service_code is not null or care_plan_id is not null)),
    'care_to_quote', (select count(*) from public.assistance_requests where status = 'submitted' and care_plan_id is not null),
    'order_payments_to_check', (select count(*) from public.assistance_requests where payment_status = 'pending_verification'),
    'care_payments_to_check', (select count(*) from public.care_invoices where status = 'pending_verification'),
    'care_overdue', (select count(*) from public.care_invoices where status = 'due' and due_on < v_today),
    'claims_to_decide', (select count(*) from public.guarantee_claims where status = 'submitted'),
    'claims_to_pay', (select count(*) from public.guarantee_claims where status = 'approved'),
    'partners_to_bill', (select count(distinct partner_id) from public.partner_charges where status = 'unbilled' and occurred_on < date_trunc('month', v_today)::date),
    'statements_overdue', (select count(*) from public.partner_statements where status = 'sent' and due_on < v_today),
    'applications_new', (select count(*) from public.partner_applications where status = 'new'),
    'staff_access_open', (select count(*) from private.staff_memberships where ended_at is null),
    'covered_missing_dates', (select count(distinct c.requirement_id) from public.care_plans p cross join lateral private.care_covered(p.id) c
                              join public.requirement_status rs on rs.id = c.requirement_id
                              where p.status = 'active' and rs.expires and rs.expires_on is null),
    'missing_invoice', (select count(*) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and coalesce(quote_php, 0) > 0 and bir_invoice_no is null)
                     + (select count(*) from public.care_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
                     + (select count(*) from public.partner_statements where status = 'paid' and bir_invoice_no is null)
                     + (select count(*) from public.payments where status = 'paid' and plan_id is not null and bir_invoice_no is null)
  ) into v;
  return v;
end $$;

insert into private.features (name) values ('autorenew') on conflict do nothing;

commit;
