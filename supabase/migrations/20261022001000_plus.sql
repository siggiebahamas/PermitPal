-- PermitPal Plus and staff licences. Everything here runs by itself: no one at PermitPal has to check,
-- approve or send anything, except confirming a GCash/bank payment while online checkout is off.
--   1) Staff licences: 3 people free; more are paid per person per month, cheaper as the team grows
--      (₱100 each for people 4-20, ₱60 each for 21-100, ₱40 each above 100). Yearly = 10 months' price.
--   2) PermitPal Plus (₱199/month or ₱1,990/year; included in every team plan; 14-day free trial):
--      a public permit page with QR poster, badges and recipients; an automatic permit check; templates.
--   3) Bills renew themselves: a bill is made 7 days before the end of each period, and people are
--      reminded. Moving up (more people, or yearly) starts a new period today with credit for unused days.
--      Moving down starts at the next period. Nothing is ever deleted when a plan ends: reminders for the
--      people above the free 3 pause, and the public page shows "paused" instead of statuses.

-- ---------------------------------------------------------------- 1) plans you add on
create table if not exists public.addons (
  org_id          uuid not null references public.orgs(id) on delete cascade,
  kind            text not null check (kind in ('plus','staff')),
  people_max      int check (people_max is null or people_max between 4 and 5000),   -- staff: the most people tracked
  billing         text not null default 'monthly' check (billing in ('monthly','yearly')),
  paid_through    date,                   -- covered up to and including this day
  trial           boolean not null default false,  -- the current period is a free trial
  trial_used_on   date,
  comped          boolean not null default false,  -- given by PermitPal staff, no bill
  next_people_max int check (next_people_max is null or next_people_max between 4 and 5000),  -- a move down, from the next period
  next_billing    text check (next_billing is null or next_billing in ('monthly','yearly')),
  started_on      date,
  updated_at      timestamptz not null default now(),
  primary key (org_id, kind),
  check ((kind = 'staff') = (people_max is not null))
);
alter table public.addons enable row level security;
drop policy if exists addons_read on public.addons;
create policy addons_read on public.addons for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
revoke insert, update, delete on public.addons from anon, authenticated;
revoke all on public.addons from anon;

create table if not exists public.addon_invoices (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  org_id         uuid not null references public.orgs(id) on delete cascade,
  kind           text not null check (kind in ('plus','staff')),
  people_max     int check (people_max is null or people_max between 4 and 5000),
  billing        text not null check (billing in ('monthly','yearly')),
  months         int not null check (months in (1, 12)),
  price_php      numeric(12,2) not null check (price_php >= 0),     -- the full price of the period
  credit_php     numeric(12,2) not null default 0 check (credit_php >= 0),  -- unused days of the period it replaces
  amount_php     numeric(12,2) not null check (amount_php >= 0),    -- what to pay
  period_start   date not null,
  period_end     date not null,
  renewal        boolean not null default false,
  status         text not null default 'due' check (status in ('due','pending_verification','paid','cancelled')),
  valid_until    date not null,
  pay_method     text check (pay_method is null or pay_method in ('gcash','maya','bank_transfer','other','online','credit')),
  pay_ref        text check (pay_ref is null or length(pay_ref) <= 120),
  proof_path     text check (proof_path is null or length(proof_path) <= 400),
  proof_name     text check (proof_name is null or length(proof_name) <= 255),
  reported_at    timestamptz,
  paid_at        timestamptz,
  bir_invoice_no text check (bir_invoice_no is null or length(bir_invoice_no) <= 60),
  note           text check (note is null or length(note) <= 500),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (period_end >= period_start),
  check (amount_php = price_php - credit_php),
  check ((kind = 'staff') = (people_max is not null))
);
create index if not exists addon_invoices_org on public.addon_invoices(org_id, created_at desc);
create index if not exists addon_invoices_open on public.addon_invoices(status) where status in ('due','pending_verification');
alter table public.addon_invoices enable row level security;
drop policy if exists addon_invoices_read on public.addon_invoices;
create policy addon_invoices_read on public.addon_invoices for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
revoke insert, update, delete on public.addon_invoices from anon, authenticated;
revoke all on public.addon_invoices from anon;

-- Online checkout (PayMongo) for these bills goes through the same payments table as team plans.
alter table public.payments add column if not exists addon_invoice_id uuid references public.addon_invoices(id) on delete set null;

-- ---------------------------------------------------------------- prices
-- Staff: people 1-3 are free; each person from the 4th to the 20th is ₱100 a month, from the 21st to
-- the 100th ₱60, from the 101st on ₱40. Each price only applies to the people in its band, so adding
-- one person never makes the whole bill jump.
create or replace function private.staff_monthly(p_people int) returns numeric
language sql immutable set search_path = '' as $$
  select (100 * greatest(0, least(p_people, 20) - 3) + 60 * greatest(0, least(p_people, 100) - 20) + 40 * greatest(0, p_people - 100))::numeric
$$;
create or replace function private.addon_price(p_kind text, p_people int, p_billing text) returns numeric
language sql immutable set search_path = '' as $$
  select (case p_kind when 'plus' then 199 else private.staff_monthly(p_people) end) * (case p_billing when 'yearly' then 10 else 1 end)
$$;
create or replace function private.addon_label(p_kind text, p_people int, p_billing text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'plus' then 'PermitPal Plus' else 'Staff licences, up to ' || p_people || ' people' end
    || case p_billing when 'yearly' then ' (yearly)' else ' (monthly)' end
$$;
-- The free people every workspace gets.
create or replace function private.free_people() returns int language sql immutable as $$ select 3 $$;

-- ---------------------------------------------------------------- who has what
create or replace function private.has_plus(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orgs o where o.id = p_org and o.deleted_at is null and (
      exists (select 1 from public.addons a where a.org_id = o.id and a.kind = 'plus' and a.paid_through >= private.today_ph())
      or (o.kind <> 'business' and ((o.trial_ends_at is not null and o.trial_ends_at > now())
                                    or private.effective_plan_id(o.id) in ('fleet','firm','head_office','property')))))
$$;
-- How many people the workspace may track today (paid licences, or the free 3).
create or replace function private.people_allowed(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$
  select greatest(private.free_people(), coalesce((select a.people_max from public.addons a
    where a.org_id = p_org and a.kind = 'staff' and a.paid_through >= private.today_ph()), 0))
$$;
-- The most people that can be added now: a move down that starts next period counts already, so
-- nobody adds people the next bill won't cover.
create or replace function private.people_cap(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$
  select least(private.people_allowed(p_org), coalesce((select greatest(private.free_people(), a.next_people_max) from public.addons a
    where a.org_id = p_org and a.kind = 'staff' and a.paid_through >= private.today_ph() and a.next_people_max is not null), 100000))
$$;
create or replace function private.active_people(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.people where org_id = p_org and deleted_at is null
$$;

-- Reminders for the people above what's paid for pause (newest first); nothing is deleted. Paying again
-- turns them back on the same day.
alter table public.people add column if not exists paused_at timestamptz;
create or replace function private.sync_people(p_org uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_allowed int := private.people_allowed(p_org); v_n int; v_prev text := coalesce(current_setting('pp.quiet_audit', true), 'off');
begin
  perform set_config('pp.quiet_audit', 'on', true);
  perform set_config('pp.people_sync', 'on', true);
  with ranked as (
    select id, row_number() over (order by created_at, id) as n from public.people where org_id = p_org and deleted_at is null
  )
  update public.people p set paused_at = case when r.n > v_allowed then now() else null end
  from ranked r where r.id = p.id and ((p.paused_at is null) <> (r.n <= v_allowed));
  get diagnostics v_n = row_count;
  -- deleted people never stay paused (they come back from Trash through the seat check)
  update public.people set paused_at = null where org_id = p_org and deleted_at is not null and paused_at is not null;
  perform set_config('pp.people_sync', 'off', true);
  perform set_config('pp.quiet_audit', v_prev, true);
  return v_n;
end $$;

create or replace function private.people_seat_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cap int; v_n int;
begin
  if tg_op = 'UPDATE' then
    -- only the nightly/plan sync changes "paused"
    if new.paused_at is distinct from old.paused_at and coalesce(current_setting('pp.people_sync', true), 'off') <> 'on' then
      new.paused_at := old.paused_at;
    end if;
    if not (old.deleted_at is not null and new.deleted_at is null) then return new; end if;
  elsif new.deleted_at is not null then return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-people:' || new.org_id::text, 0));
  v_cap := private.people_cap(new.org_id);
  select count(*) into v_n from public.people where org_id = new.org_id and deleted_at is null and id <> new.id;
  if v_n >= v_cap then
    raise exception '%', case when v_cap <= private.free_people()
        then 'You''re tracking ' || v_n || ' people: the free limit is ' || private.free_people() || '. Add staff licences (from ₱100 a month per person) under Settings > Plan to track more.'
        else 'You''re tracking ' || v_n || ' people, the most your staff licences cover. Add more under Settings > Plan.' end
      using errcode = 'P0001', hint = 'seat_limit';
  end if;
  new.paused_at := null;
  return new;
end $$;
drop trigger if exists people_seat_guard on public.people;
create trigger people_seat_guard before insert or update on public.people for each row execute function private.people_seat_guard();

create or replace function private.people_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then perform private.sync_people(new.org_id);
  elsif old.deleted_at is distinct from new.deleted_at then perform private.sync_people(new.org_id); end if;
  return null;
end $$;
drop trigger if exists people_after_change on public.people;
create trigger people_after_change after insert or update of deleted_at on public.people for each row execute function private.people_after_change();

-- ---------------------------------------------------------------- what a change costs
-- One place works out every bill, so the price on screen is always the price charged.
--   - Nothing running (or it ended): a new period from today.
--   - The same thing again: the next period, from the day after the current one ends.
--   - A free trial running: the paid period starts when the trial ends (the free days are kept).
--   - A move up: a new period from today, less the unused days of the current one.
--   - A move down: from the next period (nothing to pay now).
create or replace function private.addon_quote(p_org uuid, p_kind text, p_people int, p_billing text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.today_ph();
  a public.addons;
  v_last public.addon_invoices;
  v_months int := case p_billing when 'yearly' then 12 else 1 end;
  v_price numeric := private.addon_price(p_kind, p_people, p_billing);
  v_credit numeric := 0;
  v_start date;
  v_mode text;
  v_unused int;
begin
  select * into a from public.addons where org_id = p_org and kind = p_kind;
  if a.paid_through is null or a.paid_through < v_today then
    v_mode := 'new'; v_start := v_today;
  elsif a.trial or a.comped then
    v_mode := 'after_trial'; v_start := a.paid_through + 1;
  elsif coalesce(a.people_max, 0) = coalesce(p_people, 0) and a.billing = p_billing then
    v_mode := 'renewal'; v_start := a.paid_through + 1;
  else
    -- the bill that paid for the current period (the latest one for what's on now)
    select * into v_last from public.addon_invoices where org_id = p_org and kind = p_kind and status = 'paid'
      order by period_end desc, (people_max is not distinct from a.people_max and billing = a.billing) desc, paid_at desc, number desc limit 1;
    if v_last.id is not null and v_last.period_end >= v_today then
      v_unused := least(v_last.period_end, a.paid_through) - v_today + 1;
      v_credit := round(v_last.price_php * v_unused / (v_last.period_end - v_last.period_start + 1), 2);
    end if;
    if v_credit > v_price then
      v_mode := 'next_period'; v_start := a.paid_through + 1; v_credit := 0;
    else
      v_mode := 'change'; v_start := v_today;
    end if;
  end if;
  return jsonb_build_object('mode', v_mode, 'kind', p_kind, 'people_max', p_people, 'billing', p_billing, 'months', v_months,
    'label', private.addon_label(p_kind, p_people, p_billing), 'price', v_price, 'credit', v_credit, 'amount', v_price - v_credit,
    'monthly', private.addon_price(p_kind, p_people, 'monthly'),
    'period_start', v_start, 'period_end', ((v_start + make_interval(months => v_months))::date - 1),
    'paid_through', a.paid_through, 'people_now', private.active_people(p_org), 'free_people', private.free_people());
end $$;

create or replace function private.addon_check_args(p_org uuid, p_kind text, p_people int, p_billing text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_now int;
begin
  if p_kind not in ('plus','staff') then raise exception 'Choose Plus or staff licences.' using errcode = '22023'; end if;
  if coalesce(p_billing, '') not in ('monthly','yearly') then raise exception 'Choose monthly or yearly.' using errcode = '22023'; end if;
  if p_kind = 'plus' then
    if p_people is not null then raise exception 'Plus has no number of people.' using errcode = '22023'; end if;
    if exists (select 1 from public.orgs o where o.id = p_org and o.kind <> 'business' and private.effective_plan_id(o.id) in ('fleet','firm','head_office','property')) then
      raise exception 'Plus is already included in your team plan.' using errcode = 'P0001';
    end if;
  else
    if p_people is null or p_people < private.free_people() + 1 or p_people > 5000 then
      raise exception 'Choose from % to 5,000 people. The first % are free.', private.free_people() + 1, private.free_people() using errcode = '22023';
    end if;
    v_now := private.active_people(p_org);
    if p_people < v_now then
      raise exception 'You''re tracking % people. Remove people first, or choose at least %.', v_now, v_now using errcode = 'P0001';
    end if;
  end if;
end $$;

-- What a choice would cost, for the screen (owners and admins).
create or replace function public.addon_preview(p_org uuid, p_kind text, p_people int default null, p_billing text default 'monthly')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can change the plan.' using errcode = '42501'; end if;
  perform private.addon_check_args(p_org, p_kind, p_people, p_billing);
  return private.addon_quote(p_org, p_kind, p_people, p_billing);
end $$;

-- Makes the bill for a choice (or, for a move down, sets it for the next period). An open bill for the
-- same thing is reused, so pressing twice never makes two bills.
create or replace function public.addon_checkout(p_org uuid, p_kind text, p_people int default null, p_billing text default 'monthly')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_q jsonb; v_inv public.addon_invoices; v_today date := private.today_ph(); v_org text;
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can change the plan.' using errcode = '42501'; end if;
  perform private.addon_check_args(p_org, p_kind, p_people, p_billing);
  perform pg_advisory_xact_lock(hashtextextended('pp-addon:' || p_org::text || ':' || p_kind, 0));
  v_q := private.addon_quote(p_org, p_kind, p_people, p_billing);
  if v_q ->> 'mode' = 'next_period' then
    update public.addons set next_people_max = p_people, next_billing = p_billing, updated_at = now() where org_id = p_org and kind = p_kind;
    update public.addon_invoices set status = 'cancelled', note = 'Replaced by your new choice.'
      where org_id = p_org and kind = p_kind and status = 'due' and renewal;
    return v_q || jsonb_build_object('scheduled', true);
  end if;
  if (v_q ->> 'period_start')::date > v_today + 45 then
    raise exception 'You''ve already paid until %. You can pay for the next period from 45 days before then.', private.fmt_date((v_q ->> 'paid_through')::date) using errcode = 'P0001';
  end if;
  -- the same bill already open: use it
  select * into v_inv from public.addon_invoices where org_id = p_org and kind = p_kind and status in ('due','pending_verification')
    and people_max is not distinct from p_people and billing = p_billing and amount_php = (v_q ->> 'amount')::numeric
    and period_start = (v_q ->> 'period_start')::date order by created_at desc limit 1;
  if v_inv.id is not null then return to_jsonb(v_inv) || jsonb_build_object('label', v_q ->> 'label'); end if;
  if exists (select 1 from public.addon_invoices where org_id = p_org and kind = p_kind and status = 'pending_verification') then
    raise exception 'We''re still checking your last payment. You can change this once it''s confirmed (usually within 1 business day).' using errcode = 'P0001';
  end if;
  update public.addon_invoices set status = 'cancelled', note = 'Replaced by your new choice.' where org_id = p_org and kind = p_kind and status = 'due';
  insert into public.addon_invoices (number, org_id, kind, people_max, billing, months, price_php, credit_php, amount_php, period_start, period_end, renewal, valid_until)
  values (private.next_no('PPA'), p_org, p_kind, p_people, p_billing, (v_q ->> 'months')::int, (v_q ->> 'price')::numeric, (v_q ->> 'credit')::numeric,
    (v_q ->> 'amount')::numeric, (v_q ->> 'period_start')::date, (v_q ->> 'period_end')::date, v_q ->> 'mode' in ('renewal','after_trial'),
    case when (v_q ->> 'credit')::numeric > 0 then v_today + 2 else greatest(v_today + 7, (v_q ->> 'period_start')::date + 13) end)
  returning * into v_inv;
  -- a free bill (credit covers it) is paid at once
  if v_inv.amount_php = 0 then perform private.addon_paid(v_inv.id, 'credit', null, v_today); select * into v_inv from public.addon_invoices where id = v_inv.id; end if;
  return to_jsonb(v_inv) || jsonb_build_object('label', v_q ->> 'label');
end $$;

-- A bill is paid: switch it on, close other open bills for the same thing, wake paused people, tell the owners.
create or replace function private.addon_paid(p_invoice uuid, p_method text, p_ref text, p_pay_day date) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.addon_invoices; a public.addons; v_start date; v_end date; v_first boolean;
begin
  select * into i from public.addon_invoices where id = p_invoice for update;
  if i.id is null or i.status = 'paid' then return; end if;
  if i.status = 'cancelled' then
    -- paid after it was replaced (an old checkout left open): keep the money on record and ask staff to refund or credit it
    update public.addon_invoices set status = 'paid', paid_at = now(), pay_method = coalesce(p_method, pay_method), pay_ref = coalesce(p_ref, pay_ref),
      note = 'Paid after this bill was replaced. Refund it, or give the time with Admin > Workspaces.' where id = i.id;
    perform private.notify_admins('Refund or credit: bill ' || i.number || ' was paid after it was replaced',
      (select name from public.orgs where id = i.org_id) || ' paid ' || private.peso(i.amount_php) || ' for ' || private.addon_label(i.kind, i.people_max, i.billing) || '.',
      'addonlate:' || i.id, true);
    return;
  end if;
  select * into a from public.addons where org_id = i.org_id and kind = i.kind for update;
  v_first := a.org_id is null or a.started_on is null or a.trial;
  -- No credit used: the period starts when it's paid, if that's later (nobody pays for days they didn't have).
  v_start := case when i.credit_php > 0 then i.period_start else greatest(i.period_start, p_pay_day) end;
  if a.paid_through is not null and a.paid_through >= p_pay_day and i.credit_php = 0 then v_start := greatest(v_start, a.paid_through + 1); end if;
  v_end := (v_start + make_interval(months => i.months))::date - 1;
  update public.addon_invoices set status = 'paid', paid_at = now(), period_start = v_start, period_end = v_end,
    pay_method = coalesce(p_method, pay_method), pay_ref = coalesce(nullif(btrim(p_ref), ''), pay_ref) where id = i.id;
  insert into public.addons (org_id, kind, people_max, billing, paid_through, trial, comped, started_on)
  values (i.org_id, i.kind, i.people_max, i.billing, v_end, false, false, v_start)
  on conflict (org_id, kind) do update set people_max = excluded.people_max, billing = excluded.billing, paid_through = excluded.paid_through,
    trial = false, comped = false, started_on = coalesce(public.addons.started_on, excluded.started_on),
    next_people_max = null, next_billing = null, updated_at = now();
  delete from private.addon_stops where org_id = i.org_id and kind = i.kind;
  update public.addon_invoices set status = 'cancelled', note = 'Replaced by bill ' || i.number || '.'
    where org_id = i.org_id and kind = i.kind and status = 'due' and id <> i.id;
  if i.kind = 'staff' then perform private.sync_people(i.org_id); end if;
  perform private.notify_owners(i.org_id,
    case when i.amount_php = 0 then private.addon_label(i.kind, i.people_max, i.billing) || ' is on'
         else 'Payment received: thank you' end,
    private.addon_label(i.kind, i.people_max, i.billing) || ' is on until ' || private.fmt_date(v_end) || '.' ||
      case when i.amount_php > 0 then ' Bill ' || i.number || ', ' || private.peso(i.amount_php) || '.' else '' end,
    '#/settings/billing', 'addonpaid:' || i.id, true, true);
  if i.kind = 'plus' and v_first then perform private.run_audit(i.org_id, 'start'); perform private.audit_report(i.org_id, true); end if;
end $$;

-- GCash / Maya / bank: the customer says they paid; staff confirm once (until online checkout is on).
create or replace function public.addon_report_payment(p_invoice uuid, p_method text, p_ref text, p_proof_path text default null, p_proof_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.addon_invoices;
begin
  select * into i from public.addon_invoices where id = p_invoice for update;
  if i.id is null or not private.is_org_admin(i.org_id) then raise exception 'Bill not found.' using errcode = '42501'; end if;
  if i.status not in ('due','pending_verification') then raise exception 'This bill is already paid or was replaced.' using errcode = 'P0001'; end if;
  if i.valid_until < private.today_ph() then raise exception 'This bill has expired. Choose your plan again to get a new one.' using errcode = 'P0001'; end if;
  if coalesce(p_method, '') not in ('gcash','maya','bank_transfer','other') then raise exception 'Choose how you paid.' using errcode = '22023'; end if;
  if coalesce(btrim(p_ref), '') = '' and p_proof_path is null then raise exception 'Add the reference number or a screenshot of the payment.' using errcode = '22023'; end if;
  if length(coalesce(p_ref, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  if p_proof_path is not null and p_proof_path not like i.org_id::text || '/billing/' || i.id::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '42501';
  end if;
  update public.addon_invoices set status = 'pending_verification', pay_method = p_method, pay_ref = nullif(btrim(p_ref), ''),
    proof_path = coalesce(p_proof_path, proof_path), proof_name = coalesce(left(p_proof_name, 255), proof_name), reported_at = now(), note = null
  where id = p_invoice;
  perform private.notify_admins('Payment to confirm: ' || i.number,
    (select name from public.orgs where id = i.org_id) || ' - ' || private.peso(i.amount_php) || ' for ' || private.addon_label(i.kind, i.people_max, i.billing)
      || ' via ' || replace(p_method, '_', ' ') || coalesce(', ref ' || nullif(btrim(p_ref), ''), ''),
    'addonpay:' || p_invoice || ':' || extract(epoch from now())::bigint, true);
end $$;

create or replace function public.addon_cancel_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.addon_invoices;
begin
  select * into i from public.addon_invoices where id = p_invoice for update;
  if i.id is null or not private.is_org_admin(i.org_id) then raise exception 'Bill not found.' using errcode = '42501'; end if;
  if i.status <> 'due' then raise exception 'Only an unpaid bill can be cancelled.' using errcode = 'P0001'; end if;
  update public.addon_invoices set status = 'cancelled', note = 'Cancelled by you.' where id = i.id;
end $$;

-- Stop a plan at the end of what's paid (no refunds for the rest of the period; nothing is deleted).
create table if not exists private.addon_stops (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  kind       text not null check (kind in ('plus','staff')),
  stop_after date not null,
  created_at timestamptz not null default now(),
  primary key (org_id, kind)
);
create or replace function public.addon_stop(p_org uuid, p_kind text) returns date
language plpgsql security definer set search_path = '' as $$
declare a public.addons;
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can change the plan.' using errcode = '42501'; end if;
  select * into a from public.addons where org_id = p_org and kind = p_kind for update;
  if a.org_id is null or a.paid_through is null or a.paid_through < private.today_ph() then raise exception 'Nothing to stop.' using errcode = 'P0001'; end if;
  update public.addon_invoices set status = 'cancelled', note = 'Stopped by you.' where org_id = p_org and kind = p_kind and status = 'due';
  update public.addons set next_people_max = null, next_billing = null, updated_at = now() where org_id = p_org and kind = p_kind;
  insert into private.addon_stops (org_id, kind, stop_after) values (p_org, p_kind, a.paid_through)
    on conflict (org_id, kind) do update set stop_after = excluded.stop_after, created_at = now();
  return a.paid_through;
end $$;
create or replace function public.addon_resume(p_org uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can change the plan.' using errcode = '42501'; end if;
  delete from private.addon_stops where org_id = p_org and kind = p_kind;
end $$;
-- Which plans are set to stop, for the screen.
create or replace function public.addon_stopping(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(kind, stop_after), '{}'::jsonb) from private.addon_stops
  where org_id = p_org and p_org in (select private.my_org_ids())
$$;

-- 14 days of Plus free, once per workspace.
create or replace function public.start_plus_trial(p_org uuid) returns date
language plpgsql security definer set search_path = '' as $$
declare a public.addons; v_until date := private.today_ph() + 13;
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can start the trial.' using errcode = '42501'; end if;
  if private.has_plus(p_org) then raise exception 'Plus is already on.' using errcode = 'P0001'; end if;
  select * into a from public.addons where org_id = p_org and kind = 'plus' for update;
  if a.trial_used_on is not null or a.started_on is not null then raise exception 'This workspace has already had its free trial.' using errcode = 'P0001'; end if;
  insert into public.addons (org_id, kind, billing, paid_through, trial, trial_used_on, started_on)
  values (p_org, 'plus', 'monthly', v_until, true, private.today_ph(), null)
  on conflict (org_id, kind) do update set paid_through = v_until, trial = true, trial_used_on = private.today_ph(), updated_at = now();
  perform private.run_audit(p_org, 'start');
  perform private.audit_report(p_org, true);
  return v_until;
end $$;

-- Staff: confirm (or not) a GCash/bank payment, give time, cancel a bill.
create or replace function public.admin_confirm_addon_payment(p_invoice uuid, p_ok boolean, p_note text default null, p_invoice_no text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.addon_invoices;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into i from public.addon_invoices where id = p_invoice for update;
  if i.id is null then raise exception 'Bill not found.' using errcode = 'P0002'; end if;
  if not coalesce(p_ok, false) then
    if i.status <> 'pending_verification' then raise exception 'Nothing to check on this bill.' using errcode = 'P0001'; end if;
    update public.addon_invoices set status = 'due', valid_until = greatest(valid_until, private.today_ph() + 3),
      note = coalesce(nullif(btrim(p_note), ''), 'We could not find this payment. Please check the reference number and send it again.') where id = i.id;
    perform private.notify_owners(i.org_id, 'We couldn''t match your payment for bill ' || i.number,
      coalesce(nullif(btrim(p_note), ''), 'Please check the reference number and send it again.'), '#/settings/billing',
      'addonnomatch:' || i.id || ':' || extract(epoch from now())::bigint, true, true);
    return;
  end if;
  if i.status not in ('due','pending_verification','cancelled') then raise exception 'This bill is already paid.' using errcode = 'P0001'; end if;
  if nullif(btrim(p_invoice_no), '') is not null then update public.addon_invoices set bir_invoice_no = left(btrim(p_invoice_no), 60) where id = i.id; end if;
  perform private.addon_paid(i.id, null, null, coalesce(private.ph_day(i.reported_at), private.today_ph()));
end $$;

create or replace function public.admin_void_addon_invoice(p_invoice uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  update public.addon_invoices set status = 'cancelled', note = coalesce(nullif(btrim(p_note), ''), 'Cancelled by PermitPal.')
  where id = p_invoice and status in ('due','pending_verification');
  if not found then raise exception 'Only an unpaid bill can be cancelled.' using errcode = 'P0001'; end if;
end $$;

create or replace function public.admin_set_addon(p_org uuid, p_kind text, p_people int, p_until date, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_kind not in ('plus','staff') then raise exception 'Choose Plus or staff licences.' using errcode = '22023'; end if;
  if p_kind = 'staff' and (p_people is null or p_people < 4 or p_people > 5000) then raise exception 'Choose from 4 to 5,000 people.' using errcode = '22023'; end if;
  if p_until is null or p_until > private.today_ph() + 800 then raise exception 'Choose an end date within about 2 years.' using errcode = '22023'; end if;
  insert into public.addons (org_id, kind, people_max, billing, paid_through, comped, started_on)
  values (p_org, p_kind, case when p_kind = 'staff' then p_people end, 'monthly', p_until, true, private.today_ph())
  on conflict (org_id, kind) do update set people_max = case when p_kind = 'staff' then p_people end, paid_through = p_until,
    comped = true, trial = false, updated_at = now();
  if p_kind = 'staff' then perform private.sync_people(p_org); end if;
  perform private.notify_owners(p_org, private.addon_label(p_kind, case when p_kind = 'staff' then p_people end, 'monthly') || ' added by PermitPal',
    'On until ' || private.fmt_date(p_until) || '.' || coalesce(' ' || nullif(btrim(p_note), ''), ''), '#/settings/billing',
    'addoncomp:' || p_org || ':' || p_kind || ':' || p_until, true, true);
end $$;


-- ---------------------------------------------------------------- 2) staff: reminders to the worker, their own upload link, roles
-- A person's own email and mobile, so their licence reminders reach them too (they agreed when added).
alter table public.people add column if not exists email text
  check (email is null or (length(email) <= 254 and email ~* '^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$'));
alter table public.people add column if not exists mobile text check (mobile is null or mobile ~ '^[0-9+() -]{7,20}$');
alter table public.people add column if not exists remind_worker boolean not null default true;

-- A private link a worker uses to send a photo of a renewed licence, with no account. One per licence;
-- it stops working once used, after 45 days, or when a newer one is made.
create table if not exists public.worker_links (
  token          uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  person_id      uuid not null references public.people(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '45 days',
  used_at        timestamptz
);
create index if not exists worker_links_req on public.worker_links(requirement_id, created_at desc);
alter table public.worker_links enable row level security;
drop policy if exists worker_links_read on public.worker_links;
create policy worker_links_read on public.worker_links for select to authenticated using (org_id in (select private.my_writable_org_ids()));
revoke insert, update, delete on public.worker_links from anon, authenticated;
revoke all on public.worker_links from anon;

create table if not exists public.worker_submissions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  person_id      uuid not null references public.people(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  token          uuid not null,
  storage_path   text not null unique,
  file_name      text not null check (length(file_name) between 1 and 255),
  mime_type      text check (mime_type is null or length(mime_type) <= 100),
  size_bytes     bigint check (size_bytes is null or size_bytes between 1 and 10485760),
  reference_no   text check (reference_no is null or length(reference_no) <= 100),
  issued_on      date,
  expires_on     date,
  note           text check (note is null or length(note) <= 300),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text check (decision_note is null or length(decision_note) <= 300),
  cycle_id       uuid references public.requirement_cycles(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (issued_on is null or expires_on is null or expires_on >= issued_on)
);
create index if not exists worker_submissions_org on public.worker_submissions(org_id, status, created_at desc);
alter table public.worker_submissions enable row level security;
drop policy if exists worker_submissions_read on public.worker_submissions;
create policy worker_submissions_read on public.worker_submissions for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete on public.worker_submissions from anon, authenticated;
revoke all on public.worker_submissions from anon;

create or replace function private.worker_link_for(p_req uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_tok uuid; r public.requirements;
begin
  select * into r from public.requirements where id = p_req and deleted_at is null and subject = 'person';
  if r.id is null then return null; end if;
  select token into v_tok from public.worker_links where requirement_id = p_req and used_at is null and expires_at > now() + interval '14 days'
    order by created_at desc limit 1;
  if v_tok is null then
    insert into public.worker_links (org_id, person_id, requirement_id) values (r.org_id, r.person_id, r.id) returning token into v_tok;
  end if;
  return v_tok;
end $$;

-- HR: a link to send the worker (by Viber, Messenger, SMS or email).
create or replace function public.worker_link(p_requirement uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.requirements; v_tok uuid;
begin
  select * into r from public.requirements where id = p_requirement and deleted_at is null;
  if r.id is null or r.org_id not in (select private.my_writable_org_ids()) then raise exception 'Licence not found.' using errcode = '42501'; end if;
  if r.subject <> 'person' then raise exception 'Upload links are for staff licences.' using errcode = '22023'; end if;
  if exists (select 1 from public.people where id = r.person_id and paused_at is not null) then
    raise exception 'This person is paused because your staff licences don''t cover them. Add licences under Settings > Plan.' using errcode = 'P0001';
  end if;
  v_tok := private.worker_link_for(r.id);
  return v_tok;
end $$;

-- What the worker sees on their link (only their first name, the business and the licence).
create or replace function public.worker_page(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l public.worker_links; rs public.requirement_status; v_org text; v_first text;
begin
  select * into l from public.worker_links where token = p_token;
  if l.token is null then return jsonb_build_object('state', 'invalid'); end if;
  select * into rs from public.requirement_status where id = l.requirement_id;
  select o.name into v_org from public.orgs o where o.id = l.org_id and o.deleted_at is null;
  if rs.id is null or v_org is null then return jsonb_build_object('state', 'invalid'); end if;
  if l.used_at is not null then return jsonb_build_object('state', 'sent', 'org_name', v_org, 'permit', rs.name); end if;
  if l.expires_at < now() then return jsonb_build_object('state', 'expired', 'org_name', v_org, 'permit', rs.name); end if;
  if exists (select 1 from public.people where id = l.person_id and (deleted_at is not null or paused_at is not null)) then
    return jsonb_build_object('state', 'invalid');
  end if;
  select split_part(btrim(full_name), ' ', 1) into v_first from public.people where id = l.person_id;
  return jsonb_build_object('state', 'open', 'first_name', v_first, 'org_name', v_org, 'permit', rs.name, 'expires', rs.expires,
    'expires_on', rs.expires_on, 'folder', l.org_id::text || '/worker/' || l.token::text, 'today', private.today_ph());
end $$;

-- Where a worker's photo may go: their link's folder, while the link is open, at most 5 files.
create or replace function private.worker_folder_open(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare f text[] := string_to_array(p_name, '/');
begin
  if array_length(f, 1) <> 4 or f[2] <> 'worker' or f[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or length(f[4]) not between 1 and 200 then
    return false;
  end if;
  return exists (select 1 from public.worker_links l where l.token = f[3]::uuid and l.org_id::text = f[1] and l.used_at is null and l.expires_at > now());
end $$;
create or replace function private.worker_upload_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.worker_folder_open(p_name)
    and (select count(*) from storage.objects o where o.bucket_id = 'documents'
         and o.name like split_part(p_name, '/', 1) || '/worker/' || split_part(p_name, '/', 3) || '/%') < 5
$$;
-- Storage rules run as the visitor, who can't reach the private schema: these two public checks only
-- answer yes or no about one file path.
create or replace function public.pp_worker_may_upload(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$ select private.worker_upload_ok(p_name) $$;
create or replace function public.pp_worker_folder_open(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$ select private.worker_folder_open(p_name) $$;
drop policy if exists "documents: workers upload with their link" on storage.objects;
create policy "documents: workers upload with their link" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'documents' and public.pp_worker_may_upload(name));
drop policy if exists "documents: workers see their own upload" on storage.objects;
create policy "documents: workers see their own upload" on storage.objects for select to anon
  using (bucket_id = 'documents' and public.pp_worker_folder_open(name));

-- The worker sends the photo and the new dates. The business checks it before it counts.
create or replace function public.worker_submit(p_token uuid, p_path text, p_file_name text, p_mime text, p_size bigint,
  p_expires date, p_issued date default null, p_ref text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.worker_links; r public.requirements; v_id uuid; v_today date := private.today_ph(); v_name text; v_who record;
begin
  select * into l from public.worker_links where token = p_token for update;
  if l.token is null or l.used_at is not null or l.expires_at < now() then
    raise exception 'This link has already been used or has expired. Ask your employer for a new one.' using errcode = 'P0001';
  end if;
  select * into r from public.requirements where id = l.requirement_id and deleted_at is null;
  if r.id is null or exists (select 1 from public.people where id = l.person_id and (deleted_at is not null or paused_at is not null)) then
    raise exception 'This link is no longer active. Ask your employer for a new one.' using errcode = 'P0001';
  end if;
  if p_path is null or p_path not like l.org_id::text || '/worker/' || l.token::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = p_path) then
    raise exception 'Add a photo of the new licence first.' using errcode = '22023';
  end if;
  if r.expires and p_expires is null then raise exception 'Enter the new expiry date (it''s printed on the licence).' using errcode = '22023'; end if;
  if p_expires is not null and (p_expires < v_today - 365 or p_expires > v_today + 3700) then
    raise exception 'Check the expiry date: it doesn''t look right.' using errcode = '22023';
  end if;
  if p_issued is not null and (p_issued > v_today + 1 or (p_expires is not null and p_issued > p_expires)) then
    raise exception 'Check the date it was issued: it can''t be after today or after the expiry date.' using errcode = '22023';
  end if;
  insert into public.worker_submissions (org_id, person_id, requirement_id, token, storage_path, file_name, mime_type, size_bytes, reference_no, issued_on, expires_on, note)
  values (l.org_id, l.person_id, r.id, l.token, p_path, left(coalesce(nullif(btrim(p_file_name), ''), 'photo.jpg'), 255), left(p_mime, 100),
    case when p_size between 1 and 10485760 then p_size end, nullif(left(btrim(p_ref), 100), ''), p_issued, p_expires, nullif(left(btrim(p_note), 300), ''))
  returning id into v_id;
  update public.worker_links set used_at = now() where token = l.token;
  select full_name into v_name from public.people where id = l.person_id;
  -- tell the people who look after this licence (its assignee, else owners and admins)
  for v_who in select m.user_id from public.org_members m where m.org_id = l.org_id
      and (m.user_id = r.assignee_id or (r.assignee_id is null and m.role in ('owner','admin'))) loop
    perform private.notify(v_who.user_id, l.org_id, 'team', v_name || ' sent a renewed ' || r.name,
      'Check the photo and dates, then approve it to update their record.', '#/people/' || l.person_id, r.id, 'wsub:' || v_id || ':' || v_who.user_id, true);
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- HR approves (it becomes the licence's new record and copy) or sends it back (with a new link).
create or replace function public.worker_decide(p_submission uuid, p_approve boolean, p_expires date default null, p_issued date default null,
  p_ref text default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.worker_submissions; r public.requirements; v_cycle uuid; v_exp date; v_iss date; p public.people; v_tok uuid; v_org text; v_app text := private.setting('app_url');
begin
  select * into s from public.worker_submissions where id = p_submission for update;
  if s.id is null or s.org_id not in (select private.my_writable_org_ids()) then raise exception 'Not found.' using errcode = '42501'; end if;
  if s.status <> 'pending' then raise exception 'This was already decided.' using errcode = 'P0001'; end if;
  select * into r from public.requirements where id = s.requirement_id and deleted_at is null;
  if r.id is null then raise exception 'This licence was deleted.' using errcode = 'P0001'; end if;
  select * into p from public.people where id = s.person_id;
  if not coalesce(p_approve, false) then
    update public.worker_submissions set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(left(btrim(p_note), 300), '')
    where id = s.id;
    if p.email is not null and p.deleted_at is null and p.paused_at is null then
      v_tok := private.worker_link_for(r.id);
      select name into v_org from public.orgs where id = s.org_id;
      insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
      values (s.org_id, 'email', p.email, 'Please send your ' || r.name || ' again',
        'Hi ' || split_part(btrim(p.full_name), ' ', 1) || E',\n\n' || v_org || ' couldn''t use the photo you sent' ||
          coalesce(': ' || nullif(btrim(p_note), ''), '.') || E'\n\nSend a new one here (no account needed):\n' || v_app || '#/w/' || v_tok ||
          E'\n\nSent by PermitPal for ' || v_org || '.',
        private.email_html('Please send your ' || r.name || ' again',
          '<p>Hi ' || private.html_escape(split_part(btrim(p.full_name), ' ', 1)) || ',</p><p>' || private.html_escape(v_org) || ' couldn''t use the photo you sent'
            || coalesce(': <b>' || private.html_escape(nullif(btrim(p_note), '')) || '</b>', '.') || '</p><p>Send a new one with the button below. No account needed.</p>'
            || '<p style="color:#6B7585;font-size:13px">Sent by PermitPal for ' || private.html_escape(v_org) || '.</p>',
          'Send a new photo', v_app || '#/w/' || v_tok),
        'wrej:' || s.id);
    end if;
    return null;
  end if;
  v_exp := coalesce(p_expires, s.expires_on);
  v_iss := coalesce(p_issued, s.issued_on);
  if r.expires and v_exp is null then raise exception 'Enter the expiry date.' using errcode = '22023'; end if;
  if v_iss is not null and v_exp is not null and v_iss > v_exp then raise exception 'The issue date is after the expiry date.' using errcode = '22023'; end if;
  insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on)
  values (s.org_id, s.requirement_id, coalesce(nullif(left(btrim(p_ref), 100), ''), s.reference_no), v_iss, case when r.expires then v_exp end)
  returning id into v_cycle;
  insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name, mime_type, size_bytes)
  values (s.org_id, s.requirement_id, v_cycle, s.storage_path, s.file_name, s.mime_type, s.size_bytes);
  update public.worker_submissions set status = 'approved', decided_by = auth.uid(), decided_at = now(), cycle_id = v_cycle,
    decision_note = nullif(left(btrim(p_note), 300), '') where id = s.id;
  return v_cycle;
end $$;

-- Staff reminders to the worker: 30 and 7 days before, and once when it lapses (email, with their link).
create or replace function private.worker_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_app text := private.setting('app_url'); x record; v_tok uuid; v_n int := 0; v_when text; v_first text;
begin
  for x in
    select rs.id, rs.org_id, rs.name, rs.expires_on, rs.days_left, rs.cycle_id, p.full_name, p.email, o.name as org_name,
      case when rs.days_left < 0 then 'lapsed' when rs.days_left <= 7 then 'd7' else 'd30' end as stage
    from public.requirement_status rs
    join public.people p on p.id = rs.person_id and p.deleted_at is null and p.paused_at is null and p.remind_worker and p.email is not null
    join public.orgs o on o.id = rs.org_id and o.deleted_at is null
    where rs.subject = 'person' and rs.expires and rs.expires_on is not null and rs.days_left between -30 and 30
      and (rs.status <> 'in_progress' or rs.days_left < 0)
      and not exists (select 1 from public.worker_submissions w where w.requirement_id = rs.id and w.status = 'pending')
  loop
    continue when exists (select 1 from public.message_outbox where dedupe_key = 'wrem:' || x.cycle_id || ':' || x.stage);
    v_tok := private.worker_link_for(x.id);
    v_first := split_part(btrim(x.full_name), ' ', 1);
    v_when := case when x.days_left < 0 then 'expired on ' || private.fmt_date(x.expires_on)
                   when x.days_left = 0 then 'expires today'
                   else 'expires on ' || private.fmt_date(x.expires_on) || ' (in ' || x.days_left || ' day' || case when x.days_left = 1 then '' else 's' end || ')' end;
    insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    values (x.org_id, 'email', x.email, 'Your ' || x.name || ' ' || v_when,
      'Hi ' || v_first || E',\n\nYour ' || x.name || ' ' || v_when || '. ' || x.org_name || E' keeps a copy on file.\n\n' ||
        E'When you have the renewed one, send a photo of it here (no account needed):\n' || v_app || '#/w/' || v_tok ||
        E'\n\nThis link is just for you. Questions? Ask ' || x.org_name || E'.\n\nSent by PermitPal for ' || x.org_name || '.',
      private.email_html('Your ' || x.name || ' ' || v_when,
        '<p>Hi ' || private.html_escape(v_first) || ',</p><p>Your <b>' || private.html_escape(x.name) || '</b> ' || private.html_escape(v_when) || '. '
          || private.html_escape(x.org_name) || ' keeps a copy on file.</p><p>When you have the renewed one, send a photo of it with the button below. No account needed.</p>'
          || '<p style="color:#6B7585;font-size:13px">This link is just for you. Questions? Ask ' || private.html_escape(x.org_name) || '. Sent by PermitPal for '
          || private.html_escape(x.org_name) || '.</p>',
        'Send a photo of the new one', v_app || '#/w/' || v_tok),
      'wrem:' || x.cycle_id || ':' || x.stage)
    on conflict (dedupe_key) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Licences each role needs (the business's own rule): new people in that role get them added, and
-- the permit check points out anyone missing one.
create table if not exists public.staff_roles (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  type_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_roles_name on public.staff_roles(org_id, lower(btrim(name)));
alter table public.staff_roles enable row level security;
drop policy if exists staff_roles_read on public.staff_roles;
create policy staff_roles_read on public.staff_roles for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete on public.staff_roles from anon, authenticated;
revoke all on public.staff_roles from anon;

create or replace function public.save_staff_role(p_org uuid, p_name text, p_types text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_types text[];
begin
  if p_org not in (select private.my_writable_org_ids()) then raise exception 'You can''t change this workspace.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Give the role a name (up to 80 characters).' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct t.code order by t.code), '{}') into v_types from public.requirement_types t where t.subject = 'person' and t.code = any(coalesce(p_types, '{}'));
  insert into public.staff_roles (org_id, name, type_codes) values (p_org, btrim(p_name), v_types)
  on conflict (org_id, lower(btrim(name))) do update set type_codes = excluded.type_codes, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
create or replace function public.delete_staff_role(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.staff_roles where id = p_id and org_id in (select private.my_writable_org_ids());
  if not found then raise exception 'Role not found.' using errcode = 'P0002'; end if;
end $$;
-- Add a role's licences to everyone in it who doesn't have them yet. Returns how many were added.
create or replace function public.apply_staff_role(p_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v public.staff_roles; v_n int;
begin
  select * into v from public.staff_roles where id = p_id and org_id in (select private.my_writable_org_ids());
  if v.id is null then raise exception 'Role not found.' using errcode = 'P0002'; end if;
  perform set_config('pp.quiet_audit', 'on', true);
  insert into public.requirements (org_id, subject, person_id, type_code, name, expires, confidence)
  select v.org_id, 'person', p.id, t.code, t.name, t.expires, 'confirmed'
  from public.people p cross join public.requirement_types t
  where p.org_id = v.org_id and p.deleted_at is null and lower(btrim(p.role_title)) = lower(btrim(v.name))
    and t.code = any(v.type_codes)
    and not exists (select 1 from public.requirements r where r.person_id = p.id and r.type_code = t.code and r.deleted_at is null);
  get diagnostics v_n = row_count;
  perform set_config('pp.quiet_audit', 'off', true);
  return v_n;
end $$;


-- ---------------------------------------------------------------- 3) the public permit page (Plus)
-- One page per business (or one for the whole workspace): each permit's status, live. Shared by link,
-- QR poster, badge or email. It says exactly what PermitPal does: shows the business's own records and
-- checks them automatically; it never claims the government verified anything.
create or replace function private.trust_code() returns text
language plpgsql volatile set search_path = '' as $$
declare a text := '23456789abcdefghjkmnpqrstuvwxyz'; b bytea := extensions.gen_random_bytes(10); s text := ''; i int;
begin
  for i in 0..9 loop s := s || substr(a, 1 + (get_byte(b, i) % 31), 1); end loop;
  return s;
end $$;

create table if not exists public.trust_pages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  business_id   uuid references public.businesses(id) on delete cascade,   -- null: the whole workspace
  code          text not null unique default private.trust_code() check (code ~ '^[a-z0-9]{8,16}$'),
  title         text not null check (length(btrim(title)) between 1 and 120),
  intro         text check (intro is null or length(intro) <= 300),
  show_vehicles boolean not null default false,
  show_staff    boolean not null default false,   -- counts only, never names
  show_refs     boolean not null default false,   -- last 4 characters of reference numbers
  files         text not null default 'off' check (files in ('off','recipients','everyone')),
  hidden        uuid[] not null default '{}',     -- permits the business chose not to list
  live          boolean not null default true,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists trust_pages_one on public.trust_pages(org_id, coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.trust_pages enable row level security;
drop policy if exists trust_pages_read on public.trust_pages;
create policy trust_pages_read on public.trust_pages for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete on public.trust_pages from anon, authenticated;
revoke all on public.trust_pages from anon;

create table if not exists public.trust_recipients (
  id             uuid primary key default gen_random_uuid(),
  page_id        uuid not null references public.trust_pages(id) on delete cascade,
  org_id         uuid not null references public.orgs(id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 120),
  company        text check (company is null or length(company) <= 120),
  email          text not null check (length(email) <= 254 and email ~* '^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$'),
  token          uuid not null unique default gen_random_uuid(),
  status         text not null default 'active' check (status in ('requested','active','removed','declined')),
  source         text not null default 'owner' check (source in ('owner','request')),
  note           text check (note is null or length(note) <= 300),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  last_sent_at   timestamptz,
  last_opened_at timestamptz,
  open_count     int not null default 0
);
create unique index if not exists trust_recipients_email on public.trust_recipients(page_id, lower(email));
alter table public.trust_recipients enable row level security;
drop policy if exists trust_recipients_read on public.trust_recipients;
create policy trust_recipients_read on public.trust_recipients for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete on public.trust_recipients from anon, authenticated;
revoke all on public.trust_recipients from anon;

create table if not exists public.trust_page_views (
  id           bigint generated always as identity primary key,
  page_id      uuid not null references public.trust_pages(id) on delete cascade,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  viewed_at    timestamptz not null default now(),
  source       text not null check (source in ('link','qr','badge','email','sign','pack')),
  recipient_id uuid references public.trust_recipients(id) on delete set null
);
create index if not exists trust_page_views_page on public.trust_page_views(page_id, viewed_at desc);
alter table public.trust_page_views enable row level security;
drop policy if exists trust_page_views_read on public.trust_page_views;
create policy trust_page_views_read on public.trust_page_views for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete on public.trust_page_views from anon, authenticated;
revoke all on public.trust_page_views from anon;

-- Renewals already sent to each recipient (so nobody gets the same one twice).
create table if not exists private.trust_sent (
  recipient_id uuid not null references public.trust_recipients(id) on delete cascade,
  cycle_id     uuid not null references public.requirement_cycles(id) on delete cascade,
  sent_at      timestamptz not null default now(),
  primary key (recipient_id, cycle_id)
);

-- Which permits a page lists (permits of its business, or all businesses; vehicles if chosen; never people).
create or replace function private.trust_items(p_page uuid) returns setof public.requirement_status
language sql stable security definer set search_path = '' as $$
  select rs.* from public.trust_pages tp
  join public.requirement_status rs on rs.org_id = tp.org_id
  left join public.vehicles v on v.id = rs.vehicle_id
  where tp.id = p_page and not (rs.id = any(tp.hidden))
    and ((rs.subject = 'business' and (tp.business_id is null or rs.business_id = tp.business_id))
      or (rs.subject = 'vehicle' and tp.show_vehicles and (tp.business_id is null or v.business_id = tp.business_id)))
$$;

-- Plain public wording for each status: green current, amber due or being renewed, red expired.
create or replace function private.trust_state(p_status text, p_days int, p_expires boolean) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_status = 'compliant' then 'ok'
    when p_status = 'renew_soon' then 'due'
    when p_status = 'in_progress' and coalesce(p_days, 0) >= 0 then 'due'
    when p_status in ('action_required','in_progress') then 'expired'
    else 'pending' end
$$;

create or replace function public.trust_page_save(p_org uuid, p_business uuid, p_title text, p_intro text default null,
  p_show_vehicles boolean default false, p_show_staff boolean default false, p_show_refs boolean default false,
  p_files text default 'off', p_hidden uuid[] default '{}', p_live boolean default true) returns public.trust_pages
language plpgsql security definer set search_path = '' as $$
declare v public.trust_pages;
begin
  if p_org not in (select private.my_writable_org_ids()) then raise exception 'You can''t change this workspace.' using errcode = '42501'; end if;
  if not private.has_plus(p_org) then raise exception 'Your public permit page comes with PermitPal Plus.' using errcode = 'P0001', hint = 'plus'; end if;
  if p_business is not null and not exists (select 1 from public.businesses where id = p_business and org_id = p_org and deleted_at is null) then
    raise exception 'That business was not found.' using errcode = '23503';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Give the page a name (up to 120 characters).' using errcode = '22023'; end if;
  if length(coalesce(p_intro, '')) > 300 then raise exception 'Keep the introduction under 300 characters.' using errcode = '22023'; end if;
  if coalesce(p_files, '') not in ('off','recipients','everyone') then raise exception 'Choose who can download copies.' using errcode = '22023'; end if;
  insert into public.trust_pages (org_id, business_id, title, intro, show_vehicles, show_staff, show_refs, files, hidden, live)
  values (p_org, p_business, btrim(p_title), nullif(btrim(p_intro), ''), coalesce(p_show_vehicles, false), coalesce(p_show_staff, false),
    coalesce(p_show_refs, false), p_files, coalesce((select array_agg(id) from public.requirements where id = any(coalesce(p_hidden, '{}')) and org_id = p_org), '{}'),
    coalesce(p_live, true))
  on conflict (org_id, coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
    title = excluded.title, intro = excluded.intro, show_vehicles = excluded.show_vehicles, show_staff = excluded.show_staff,
    show_refs = excluded.show_refs, files = excluded.files, hidden = excluded.hidden, live = excluded.live, updated_at = now()
  returning * into v;
  return v;
end $$;

-- A new address for the page (the old link and printed QR codes stop working).
create or replace function public.trust_page_new_code(p_page uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  update public.trust_pages set code = private.trust_code(), updated_at = now()
  where id = p_page and org_id in (select private.my_writable_org_ids()) returning code into v;
  if v is null then raise exception 'Page not found.' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.trust_page_delete(p_page uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.trust_pages where id = p_page and org_id in (select private.my_writable_org_ids());
  if not found then raise exception 'Page not found.' using errcode = 'P0002'; end if;
end $$;

-- The public page. Anyone with the address can open it; visits are counted by where they came from.
create or replace function public.get_trust_page(p_code text, p_src text default 'link', p_rcpt uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tp public.trust_pages; o public.orgs; v_rcpt public.trust_recipients; v_items jsonb; v_staff jsonb; v_files boolean;
  v_checked timestamptz; v_src text := case when p_src in ('link','qr','badge','email','sign','pack') then p_src else 'link' end; v_biz text; v_city text;
begin
  if p_code is null or p_code !~ '^[a-z0-9]{8,16}$' then return jsonb_build_object('state', 'missing'); end if;
  select * into tp from public.trust_pages where code = p_code;
  if tp.id is null then return jsonb_build_object('state', 'missing'); end if;
  select * into o from public.orgs where id = tp.org_id and deleted_at is null;
  if o.id is null then return jsonb_build_object('state', 'missing'); end if;
  if not tp.live or not private.has_plus(tp.org_id) then return jsonb_build_object('state', 'paused', 'title', tp.title); end if;
  if p_rcpt is not null then
    select * into v_rcpt from public.trust_recipients where token = p_rcpt and page_id = tp.id and status = 'active';
  end if;
  v_files := tp.files = 'everyone' or (tp.files = 'recipients' and v_rcpt.id is not null);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', rs.id, 'name', rs.name, 'subject', rs.subject,
      'group', case when rs.subject = 'vehicle' then concat_ws(' · ', nullif(rs.subject_name, ''), nullif(rs.plate_no, ''))
                    when tp.business_id is null or coalesce(rs.location_is_main, true) = false
                      then concat_ws(' · ', rs.subject_name, case when rs.location_id is not null and not coalesce(rs.location_is_main, false) then rs.location_name end)
                    else rs.subject_name end,
      'state', private.trust_state(rs.status, rs.days_left, rs.expires),
      'in_progress', rs.status = 'in_progress',
      'expires', rs.expires, 'expires_on', rs.expires_on, 'issued_on', rs.issued_on, 'issuer', rs.issuer,
      'ref', case when tp.show_refs and length(coalesce(rs.reference_no, '')) >= 4 then '•••• ' || right(rs.reference_no, 4) end,
      'on_file', rs.document_count > 0,
      'files', case when v_files and rs.document_count > 0 then (
          select coalesce(jsonb_agg(jsonb_build_object('path', d.storage_path, 'name', d.file_name) order by d.created_at), '[]'::jsonb)
          from public.documents d where d.cycle_id = rs.cycle_id and d.deleted_at is null) end)
      order by rs.subject, rs.subject_name, rs.location_is_main desc nulls first, rs.location_name nulls first, rs.name), '[]'::jsonb)
    into v_items
  from private.trust_items(tp.id) rs;
  if tp.show_staff then
    select jsonb_build_object('people', count(distinct rs.person_id), 'licences', count(*),
        'ok', count(*) filter (where private.trust_state(rs.status, rs.days_left, rs.expires) = 'ok'),
        'due', count(*) filter (where private.trust_state(rs.status, rs.days_left, rs.expires) = 'due'),
        'expired', count(*) filter (where private.trust_state(rs.status, rs.days_left, rs.expires) = 'expired'))
      into v_staff
    from public.requirement_status rs join public.people p on p.id = rs.person_id and p.paused_at is null
    where rs.org_id = tp.org_id and rs.subject = 'person' and (tp.business_id is null or p.business_id = tp.business_id);
  end if;
  select max(ran_at) into v_checked from public.audit_runs where org_id = tp.org_id;
  if tp.business_id is not null then
    select b.name, l.city into v_biz, v_city from public.businesses b
      left join public.business_locations l on l.business_id = b.id and l.is_main and l.deleted_at is null where b.id = tp.business_id;
  end if;
  -- count the visit (a few hundred a day per page at most, so nobody can flood the counts)
  if (select count(*) from public.trust_page_views where page_id = tp.id and viewed_at > now() - interval '1 day') < 500 then
    insert into public.trust_page_views (page_id, org_id, source, recipient_id) values (tp.id, tp.org_id, case when v_rcpt.id is not null then 'email' else v_src end, v_rcpt.id);
  end if;
  if v_rcpt.id is not null then
    update public.trust_recipients set last_opened_at = now(), open_count = open_count + 1 where id = v_rcpt.id;
  end if;
  return jsonb_build_object('state', 'live', 'title', tp.title, 'intro', tp.intro, 'business', coalesce(v_biz, o.name), 'city', nullif(v_city, ''),
    'as_of', private.today_ph(), 'now', now(), 'checked_at', coalesce(v_checked, now()), 'items', v_items, 'staff', v_staff,
    'files', tp.files, 'can_download', v_files, 'recipient', case when v_rcpt.id is not null then v_rcpt.name end,
    'since', private.ph_day(tp.created_at));
end $$;

-- The website badge: only the headline, and no visit counted (it loads on every visit to the business's site;
-- a click through to the page is counted there).
create or replace function public.trust_badge(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare tp public.trust_pages; v jsonb;
begin
  if p_code is null or p_code !~ '^[a-z0-9]{8,16}$' then return jsonb_build_object('state', 'missing'); end if;
  select * into tp from public.trust_pages where code = p_code;
  if tp.id is null or not exists (select 1 from public.orgs where id = tp.org_id and deleted_at is null) then return jsonb_build_object('state', 'missing'); end if;
  if not tp.live or not private.has_plus(tp.org_id) then return jsonb_build_object('state', 'paused', 'title', tp.title); end if;
  select jsonb_build_object('state', 'live', 'title', tp.title, 'items', count(*),
      'ok', count(*) filter (where private.trust_state(rs.status, rs.days_left, rs.expires) = 'ok'),
      'due', count(*) filter (where private.trust_state(rs.status, rs.days_left, rs.expires) = 'due'),
      'expired', count(*) filter (where private.trust_state(rs.status, rs.days_left, rs.expires) = 'expired'),
      'pending', count(*) filter (where private.trust_state(rs.status, rs.days_left, rs.expires) = 'pending'),
      'checked_at', (select max(ran_at) from public.audit_runs where org_id = tp.org_id), 'as_of', private.today_ph())
    into v
  from private.trust_items(tp.id) rs;
  return v;
end $$;

-- Copies on the public page: the current document of a listed permit, while the page is live, Plus is
-- on and the business allows downloads. Turning downloads off stops every copy at once.
create or replace function private.trust_file_ok(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    join public.trust_pages tp on tp.org_id = d.org_id and tp.live and tp.files <> 'off'
    join lateral private.trust_items(tp.id) rs on rs.id = d.requirement_id and rs.cycle_id = d.cycle_id
    where d.storage_path = p_path and d.deleted_at is null and private.has_plus(d.org_id))
$$;
create or replace function public.pp_public_copy(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$ select private.trust_file_ok(p_name) $$;
drop policy if exists "documents: public permit page copies" on storage.objects;
create policy "documents: public permit page copies" on storage.objects for select to anon, authenticated
  using (bucket_id = 'documents' and public.pp_public_copy(name));

-- Recipients: people (a client's vendor desk, a mall, a landlord) who get each renewal by email.
create or replace function private.trust_welcome(p_rcpt uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.trust_recipients; tp public.trust_pages; v_app text := private.setting('app_url'); v_url text; v_who text;
begin
  select * into r from public.trust_recipients where id = p_rcpt;
  select * into tp from public.trust_pages where id = r.page_id;
  v_url := rtrim(v_app, '/') || '/p.html?c=' || tp.code || '&r=' || r.token;
  v_who := tp.title;
  insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
  values (r.org_id, 'email', r.email, v_who || ' will send you their permit renewals',
    'Hi ' || r.name || E',\n\n' || v_who || ' added you to get their permit updates. Each time they renew a permit you''ll get an email with the new expiry date.' ||
      E'\n\nTheir permits, live: ' || v_url || E'\n\nStop these emails: ' || v_url || '&stop=1' || E'\n\nSent by PermitPal for ' || v_who || '.',
    private.email_html(v_who || ' will send you their permit renewals',
      '<p>Hi ' || private.html_escape(r.name) || ',</p><p><b>' || private.html_escape(v_who) || '</b> added you to get their permit updates. Each time they renew a permit you''ll get an email with the new expiry date'
        || case when tp.files <> 'off' then ' and a copy you can download' else '' end || '.</p>'
        || '<p style="color:#6B7585;font-size:13px">PermitPal shows the business''s own records and checks them automatically. It doesn''t issue permits or verify them with the government. '
        || '<a href="' || private.html_escape(v_url || '&stop=1') || '">Stop these emails</a>.</p>',
      'See their permits', v_url),
    'trustwelcome:' || r.id)
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function public.trust_add_recipient(p_page uuid, p_name text, p_company text, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tp public.trust_pages; v_id uuid; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into tp from public.trust_pages where id = p_page and org_id in (select private.my_writable_org_ids());
  if tp.id is null then raise exception 'Page not found.' using errcode = 'P0002'; end if;
  if not private.has_plus(tp.org_id) then raise exception 'Recipients come with PermitPal Plus.' using errcode = 'P0001', hint = 'plus'; end if;
  if v_email !~* '^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$' or length(v_email) > 254 then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'Enter their name.' using errcode = '22023'; end if;
  if (select count(*) from public.trust_recipients where page_id = tp.id and status in ('active','requested')) >= 200 then
    raise exception 'A page can have up to 200 recipients.' using errcode = 'P0001';
  end if;
  insert into public.trust_recipients (page_id, org_id, name, company, email, status, source, decided_at)
  values (tp.id, tp.org_id, btrim(p_name), nullif(left(btrim(p_company), 120), ''), v_email, 'active', 'owner', now())
  on conflict (page_id, lower(email)) do update set name = excluded.name, company = excluded.company, status = 'active', decided_at = now()
  returning id into v_id;
  perform private.trust_welcome(v_id);
  return v_id;
end $$;

create or replace function public.trust_remove_recipient(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.trust_recipients set status = 'removed', decided_at = now() where id = p_id and org_id in (select private.my_writable_org_ids());
  if not found then raise exception 'Not found.' using errcode = 'P0002'; end if;
end $$;

-- A visitor asks to get the updates; the business says yes or no (nobody is emailed until then).
create or replace function public.trust_request_updates(p_code text, p_name text, p_company text, p_email text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tp public.trust_pages; v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  select * into tp from public.trust_pages where code = p_code and live;
  if tp.id is null or not private.has_plus(tp.org_id) then raise exception 'This page isn''t available.' using errcode = 'P0002'; end if;
  if v_email !~* '^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$' or length(v_email) > 254 then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'Enter your name.' using errcode = '22023'; end if;
  if length(coalesce(p_company, '')) > 120 or length(coalesce(p_note, '')) > 300 then raise exception 'That''s too long.' using errcode = '22023'; end if;
  if exists (select 1 from public.trust_recipients where page_id = tp.id and lower(email) = v_email) then
    return jsonb_build_object('ok', true);   -- already asked or already on the list: same answer, nothing new
  end if;
  if (select count(*) from public.trust_recipients where page_id = tp.id and source = 'request' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'This business has had a lot of requests today. Please try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.trust_recipients (page_id, org_id, name, company, email, status, source, note)
  values (tp.id, tp.org_id, btrim(p_name), nullif(left(btrim(p_company), 120), ''), v_email, 'requested', 'request', nullif(left(btrim(p_note), 300), ''))
  returning id into v_id;
  perform private.notify_owners(tp.org_id, btrim(p_name) || coalesce(' (' || nullif(btrim(p_company), '') || ')', '') || ' asked for your permit updates',
    'From your public permit page. Say yes and they''ll get an email each time you renew a permit.', '#/sharing', 'trustreq:' || v_id, true, true);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.trust_decide_request(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.trust_recipients;
begin
  select * into r from public.trust_recipients where id = p_id and org_id in (select private.my_writable_org_ids()) for update;
  if r.id is null then raise exception 'Not found.' using errcode = 'P0002'; end if;
  if r.status <> 'requested' then raise exception 'This was already answered.' using errcode = 'P0001'; end if;
  update public.trust_recipients set status = case when p_ok then 'active' else 'declined' end, decided_at = now() where id = r.id;
  if p_ok then perform private.trust_welcome(r.id); end if;
end $$;

-- "Stop these emails" in every email works without signing in.
create or replace function public.trust_unsubscribe(p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.trust_recipients set status = 'removed', decided_at = now() where token = p_token and status = 'active';
  return found;
end $$;

-- Each new permit record on a page (a renewal, or one added; with its copy uploaded) goes to the page's
-- recipients, once, the next morning. Only records added after the recipient joined.
create or replace function private.trust_updates() returns int
language plpgsql security definer set search_path = '' as $$
declare v_app text := private.setting('app_url'); x record; v_n int := 0; v_url text;
begin
  for x in
    select r.id as rcpt, r.name, r.email, r.token, r.org_id, tp.code, tp.title, tp.files,
      jsonb_agg(jsonb_build_object('cycle', rs.cycle_id, 'name', rs.name, 'group', rs.subject_name, 'expires_on', rs.expires_on) order by rs.name) as items
    from public.trust_recipients r
    join public.trust_pages tp on tp.id = r.page_id and tp.live
    join lateral private.trust_items(tp.id) rs on true
    join public.requirement_cycles c on c.id = rs.cycle_id
    where r.status = 'active' and private.has_plus(tp.org_id)
      and c.created_at > greatest(r.created_at, now() - interval '14 days') and rs.document_count > 0
      and rs.status in ('compliant','renew_soon')
      and not exists (select 1 from private.trust_sent s where s.recipient_id = r.id and s.cycle_id = rs.cycle_id)
    group by r.id, r.name, r.email, r.token, r.org_id, tp.code, tp.title, tp.files
  loop
    v_url := rtrim(v_app, '/') || '/p.html?c=' || x.code || '&r=' || x.token;
    insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    values (x.org_id, 'email', x.email,
      x.title || ' updated ' || case when jsonb_array_length(x.items) = 1 then 'their ' || (x.items -> 0 ->> 'name') else jsonb_array_length(x.items) || ' permits' end,
      'Hi ' || x.name || E',\n\n' || x.title || E' has new permits on file:\n' ||
        (select string_agg('- ' || (i ->> 'name') || coalesce(', valid until ' || private.fmt_date((i ->> 'expires_on')::date), ''), E'\n') from jsonb_array_elements(x.items) i) ||
        E'\n\nSee all their permits' || case when x.files <> 'off' then ' and download copies' else '' end || ': ' || v_url ||
        E'\n\nStop these emails: ' || v_url || '&stop=1' || E'\n\nSent by PermitPal for ' || x.title || '.',
      private.email_html(x.title || ' updated ' || case when jsonb_array_length(x.items) = 1 then 'their ' || (x.items -> 0 ->> 'name') else jsonb_array_length(x.items) || ' permits' end,
        '<p>Hi ' || private.html_escape(x.name) || ',</p><p><b>' || private.html_escape(x.title) || '</b> has new permits on file:</p><ul style="padding-left:18px">' ||
          (select string_agg('<li style="margin:4px 0">' || private.html_escape(i ->> 'name') || coalesce(', valid until <b>' || private.fmt_date((i ->> 'expires_on')::date) || '</b>', '') || '</li>', '')
           from jsonb_array_elements(x.items) i) || '</ul>'
          || '<p style="color:#6B7585;font-size:13px">From the business''s own PermitPal records, checked automatically. PermitPal doesn''t verify permits with the government. '
          || '<a href="' || private.html_escape(v_url || '&stop=1') || '">Stop these emails</a>.</p>',
        case when x.files <> 'off' then 'See permits and copies' else 'See their permits' end, v_url),
      'trustupd:' || x.rcpt || ':' || private.today_ph())
    on conflict (dedupe_key) do nothing;
    insert into private.trust_sent (recipient_id, cycle_id) select x.rcpt, (i ->> 'cycle')::uuid from jsonb_array_elements(x.items) i on conflict do nothing;
    update public.trust_recipients set last_sent_at = now() where id = x.rcpt;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;


-- ---------------------------------------------------------------- 4) the automatic permit check (Plus)
-- Runs every morning and whenever someone opens it. Two kinds of findings, never mixed up:
--   "fix"     facts from the business's own records (expired, no copy uploaded, no expiry date, a role's
--             licence missing). These can't be waved away; they close by themselves once fixed.
--   "confirm" things that look off but might be right (a date that's unusually far off, a permit most
--             businesses like this need, a photo that seems to say a different date, a permit listed
--             twice). Phrased as a question; "It's right" closes it until the record changes.
--   "soon"    renewals coming up in the next 60 days.
-- Nothing is ever stated as checked with the government.
alter table public.documents add column if not exists reading jsonb check (reading is null or (jsonb_typeof(reading) = 'object' and length(reading::text) <= 4000));
alter table public.documents add column if not exists read_at timestamptz;

create table if not exists public.audit_findings (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  key            text not null,
  kind           text not null,
  severity       text not null check (severity in ('fix','confirm','soon')),
  title          text not null,
  detail         text not null,
  action         text,
  requirement_id uuid references public.requirements(id) on delete cascade,
  business_id    uuid references public.businesses(id) on delete cascade,
  location_id    uuid references public.business_locations(id) on delete cascade,
  vehicle_id     uuid references public.vehicles(id) on delete cascade,
  person_id      uuid references public.people(id) on delete cascade,
  type_code      text,
  fingerprint    text not null,
  status         text not null default 'open' check (status in ('open','fixed','dismissed')),
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      uuid references auth.users(id) on delete set null,
  note           text check (note is null or length(note) <= 300),
  unique (org_id, key)
);
create index if not exists audit_findings_open on public.audit_findings(org_id, status);
alter table public.audit_findings enable row level security;
drop policy if exists audit_findings_read on public.audit_findings;
create policy audit_findings_read on public.audit_findings for select to authenticated
  using (org_id in (select private.my_org_ids()) and private.has_plus(org_id));
revoke insert, update, delete on public.audit_findings from anon, authenticated;
revoke all on public.audit_findings from anon;

create table if not exists public.audit_runs (
  id       bigint generated always as identity primary key,
  org_id   uuid not null references public.orgs(id) on delete cascade,
  ran_at   timestamptz not null default now(),
  trigger  text not null default 'daily' check (trigger in ('daily','open','start','manual')),
  fix      int not null default 0,
  confirm  int not null default 0,
  soon     int not null default 0,
  items    int not null default 0,
  in_order int not null default 0
);
create index if not exists audit_runs_org on public.audit_runs(org_id, ran_at desc);
alter table public.audit_runs enable row level security;
drop policy if exists audit_runs_read on public.audit_runs;
create policy audit_runs_read on public.audit_runs for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete on public.audit_runs from anon, authenticated;
revoke all on public.audit_runs from anon;

-- How long a permit usually lasts, by how its renewal date is set (null: no usual length).
create or replace function private.usual_months(p_rule text) returns int
language sql immutable set search_path = '' as $$
  select case p_rule when 'jan20' then 13 when 'annual' then 13 when 'months6' then 7 when 'years2' then 25 when 'years5' then 61 when 'lto_plate' then 37 end
$$;

-- Everything the check finds right now. Paused people are left out (their reminders are off too).
create or replace function private.audit_scan(p_org uuid) returns table (
  key text, kind text, severity text, title text, detail text, action text, requirement_id uuid, business_id uuid, location_id uuid,
  vehicle_id uuid, person_id uuid, type_code text, fingerprint text)
language sql stable security definer set search_path = '' as $$
  with today as (select private.today_ph() as d),
  items as (
    select rs.*, t.due_rule,
      coalesce(rs.subject_name, '') || case when rs.location_id is not null and not coalesce(rs.location_is_main, true) then ' (' || rs.location_name || ')' else '' end
        || case when coalesce(rs.plate_no, '') <> '' then ' · ' || rs.plate_no else '' end as who,
      regexp_replace(lower(rs.name), '[^a-z0-9]+', '', 'g') as norm,
      array(select distinct w from regexp_split_to_table(replace(lower(rs.name), '''', ''), '[^a-z0-9]+') w
            where w <> '' and w not in ('of','the','and','for','to','a','an','ng','sa','or')) as words
    from public.requirement_status rs
    left join public.requirement_types t on t.code = rs.type_code
    left join public.people p on p.id = rs.person_id
    where rs.org_id = p_org and (rs.person_id is null or p.paused_at is null)
  ),
  facts as (
    -- expired, and nobody has started renewing it
    select 'expired:' || i.id, 'expired', 'fix',
      i.name || ' expired ' || private.fmt_date(i.expires_on),
      i.who || '. Renew it, or if it''s already renewed, add the new expiry date and copy.', 'renew',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, i.cycle_id::text
    from items i where i.status = 'action_required'
    union all
    -- nothing recorded yet
    select 'nodetails:' || i.id, 'no_details', 'fix', 'No details for ' || i.name || ' yet',
      i.who || '. Add the reference number' || case when i.expires then ', expiry date' else '' end || ' and a copy, or remove it if it doesn''t apply.', 'add_details',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, 'none'
    from items i where i.cycle_id is null
    union all
    -- recorded, but no expiry date
    select 'noexpiry:' || i.id, 'no_expiry', 'fix', 'Expiry date missing: ' || i.name,
      i.who || '. Without it we can''t remind you before it lapses.', 'add_details',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, i.cycle_id::text
    from items i where i.cycle_id is not null and i.expires and i.expires_on is null
    union all
    -- recorded, but no copy uploaded
    select 'nocopy:' || i.id, 'no_copy', 'fix', 'No copy uploaded: ' || i.name,
      i.who || '. Upload a photo or scan, so it''s ready when an inspector or client asks.', 'upload',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, i.cycle_id::text
    from items i where i.cycle_id is not null and i.document_count = 0 and not (i.expires and i.expires_on is null)
    union all
    -- coming up in the next 60 days
    select 'soon:' || i.id, 'due_soon', 'soon',
      i.name || ' expires ' || private.fmt_date(i.expires_on) || ' (in ' || i.days_left || ' day' || case when i.days_left = 1 then '' else 's' end || ')',
      i.who || '. Start the renewal early: offices get busy near deadlines.', 'renew',
      i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, i.cycle_id::text
    from items i where i.expires and i.expires_on is not null and i.days_left between 0 and 60 and i.status <> 'in_progress'
    union all
    -- dates that look off (asked, not stated)
    select 'dates:' || i.id, 'date_check', 'confirm',
      case when i.issued_on > (select d from today) + 1 then 'Is the issue date right? ' || i.name
           else 'Is the expiry date right? ' || i.name end,
      i.who || case
        when i.issued_on > (select d from today) + 1 then '. It says it was issued on ' || private.fmt_date(i.issued_on) || ', which is in the future.'
        when private.usual_months(i.due_rule) is not null then '. It says it''s valid until ' || private.fmt_date(i.expires_on) ||
          ', but this kind usually lasts up to ' || case private.usual_months(i.due_rule) when 13 then 'a year' when 7 then '6 months' when 25 then '2 years' when 37 then '3 years' else '5 years' end || '.'
        else '. It says it''s valid until ' || private.fmt_date(i.expires_on) || ', more than 10 years from now.' end,
      'review', i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code,
      i.cycle_id::text || ':' || coalesce(i.issued_on::text, '') || ':' || coalesce(i.expires_on::text, '')
    from items i
    where i.cycle_id is not null and (
      i.issued_on > (select d from today) + 1
      or (i.expires_on is not null and private.usual_months(i.due_rule) is not null
          and i.expires_on > coalesce(i.issued_on, (select d from today)) + make_interval(months => private.usual_months(i.due_rule)) + interval '31 days')
      or (i.expires_on is not null and private.usual_months(i.due_rule) is null and i.expires_on > (select d from today) + interval '10 years'))
    union all
    -- the photo seems to show a different expiry date than the one saved (read on the customer's phone)
    select 'photodate:' || i.id, 'photo_date', 'confirm', 'Which expiry date is right? ' || i.name,
      i.who || '. The uploaded photo seems to say ' || private.fmt_date((d.reading -> 'expires' ->> 0)::date) || ', but ' || private.fmt_date(i.expires_on) ||
        ' is saved. Photos can be misread, so check the paper.',
      'review', i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, d.id::text || ':' || i.expires_on::text
    from items i
    join lateral (select x.id, x.reading from public.documents x where x.cycle_id = i.cycle_id and x.deleted_at is null and x.reading ? 'expires'
                  and jsonb_typeof(x.reading -> 'expires') = 'array' and jsonb_array_length(x.reading -> 'expires') > 0
                  order by x.created_at desc limit 1) d on true
    where i.expires_on is not null and (d.reading -> 'expires' ->> 0) ~ '^\d{4}-\d{2}-\d{2}$'
      and not exists (select 1 from jsonb_array_elements_text(d.reading -> 'expires') e where e = i.expires_on::text)
    union all
    -- the photo looks like a different kind of document
    select 'photokind:' || i.id, 'photo_kind', 'confirm', 'Is this the right file? ' || i.name,
      i.who || '. The uploaded photo looks like a ' || coalesce((select t.name from public.requirement_types t where t.code = d.reading ->> 'kind'), d.reading ->> 'kind') ||
        '. If the wrong file was uploaded, replace it.',
      'review', i.id, i.business_id, i.location_id, i.vehicle_id, i.person_id, i.type_code, d.id::text
    from items i
    join lateral (select x.id, x.reading from public.documents x where x.cycle_id = i.cycle_id and x.deleted_at is null and x.reading ? 'kind'
                  order by x.created_at desc limit 1) d on true
    where i.type_code is not null and d.reading ->> 'kind' is not null and d.reading ->> 'kind' <> i.type_code
      and exists (select 1 from public.requirement_types t where t.code = d.reading ->> 'kind')
    union all
    -- listed twice (same name for the same business/branch, vehicle or person)
    select 'twice:' || a.id || ':' || b.id, 'duplicate', 'confirm', 'Listed twice? ' || a.name,
      a.who || ' has "' || a.name || '" and "' || b.name || '". If they''re the same permit, remove one.', 'review',
      a.id, a.business_id, a.location_id, a.vehicle_id, a.person_id, a.type_code, 'v1'
    from items a join items b on a.id < b.id
      and a.business_id is not distinct from b.business_id
      and (a.location_id is not distinct from b.location_id or a.location_id is null or b.location_id is null)
      and a.vehicle_id is not distinct from b.vehicle_id and a.person_id is not distinct from b.person_id
      and (a.type_code is null or b.type_code is null or a.type_code = b.type_code)
      and (a.norm = b.norm or (least(cardinality(a.words), cardinality(b.words)) >= 2 and (a.words <@ b.words or b.words <@ a.words)))
  ),
  common as (
    -- what businesses like this usually need, missing from the list (the business can say it doesn't apply)
    select 'common:' || b.id || ':' || coalesce(l.id::text, '-') || ':' || t.code, 'missing_common', 'confirm',
      'Do you need a ' || t.name || '?',
      'Most ' || case b.activity when 'restaurant' then 'restaurants and food businesses' when 'retail' then 'stores' when 'healthcare' then 'clinics'
        when 'school' then 'schools' when 'construction' then 'construction businesses' when 'manufacturing' then 'manufacturers' else 'businesses like yours' end ||
        ' need one, and it isn''t on ' || b.name || case when l.id is not null and not l.is_main then ' (' || l.name || ')' else '' end || '''s list. Add it, or tell us it doesn''t apply.',
      'add_permit', null::uuid, b.id, l.id, null::uuid, null::uuid, t.code, 'v1'
    from public.businesses b
    join public.requirement_types t on t.subject = 'business' and t.auto_add and t.confidence in ('confirmed','likely')
      and (t.activities is null or b.activity = any(t.activities)) and (t.structures is null or b.structure = any(t.structures))
    left join public.business_locations l on t.per_location and l.business_id = b.id and l.deleted_at is null
    where b.org_id = p_org and b.deleted_at is null and (not t.per_location or l.id is not null)
      and not exists (select 1 from public.requirements r where r.business_id = b.id and r.type_code = t.code and r.deleted_at is null
                      and (not t.per_location or r.location_id = l.id or r.location_id is null))
    union all
    -- a vehicle with no registration or no insurance on its list
    select 'vehicle:' || v.id || ':' || t.code, 'vehicle_missing', 'confirm', 'No ' || t.name || ' for ' || coalesce(nullif(v.plate_no, ''), v.make_model) || '?',
      v.make_model || coalesce(' · ' || nullif(v.plate_no, ''), '') || ' has no ' || t.name || ' on its list. Add it, or tell us it doesn''t apply.',
      'add_permit', null, v.business_id, null, v.id, null, t.code, 'v1'
    from public.vehicles v join public.requirement_types t on t.code in ('lto_registration','ctpl')
    where v.org_id = p_org and v.deleted_at is null
      and not exists (select 1 from public.requirements r where r.vehicle_id = v.id and r.type_code = t.code and r.deleted_at is null)
    union all
    -- a branch with nothing on its list
    select 'emptybranch:' || l.id, 'branch_empty', 'confirm', 'Nothing listed for ' || b.name || ' (' || l.name || ')',
      'This branch has no permits on its list. Most branches need their own business permit and fire safety certificate.', 'add_permit',
      null, b.id, l.id, null, null, null, 'v1'
    from public.business_locations l join public.businesses b on b.id = l.business_id and b.deleted_at is null
    where l.org_id = p_org and l.deleted_at is null and not l.is_main
      and not exists (select 1 from public.requirements r where r.location_id = l.id and r.deleted_at is null)
  ),
  roles as (
    -- someone in a role is missing a licence the business said that role needs
    select 'role:' || p.id || ':' || t.code, 'role_missing', 'fix', p.full_name || ' needs a ' || t.name,
      'Your rule for ' || sr.name || ': ' || (select string_agg(tt.name, ', ' order by tt.sort) from public.requirement_types tt where tt.code = any(sr.type_codes)) ||
        '. Add it to ' || split_part(btrim(p.full_name), ' ', 1) || '''s list.', 'add_licence',
      null::uuid, p.business_id, null::uuid, null::uuid, p.id, t.code, array_to_string(sr.type_codes, ',')
    from public.people p
    join public.staff_roles sr on sr.org_id = p.org_id and lower(btrim(sr.name)) = lower(btrim(p.role_title))
    join public.requirement_types t on t.code = any(sr.type_codes)
    where p.org_id = p_org and p.deleted_at is null and p.paused_at is null
      and not exists (select 1 from public.requirements r where r.person_id = p.id and r.type_code = t.code and r.deleted_at is null)
  )
  select * from facts union all select * from common union all select * from roles
$$;

-- Records what the check found: new things open, fixed things close, "It's right" stays until the record changes.
create or replace function private.run_audit(p_org uuid, p_trigger text default 'daily') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  create temp table if not exists pp_audit_now (key text primary key, kind text, severity text, title text, detail text, action text, requirement_id uuid,
    business_id uuid, location_id uuid, vehicle_id uuid, person_id uuid, type_code text, fingerprint text) on commit drop;
  delete from pp_audit_now;
  insert into pp_audit_now select distinct on (s.key) s.* from private.audit_scan(p_org) s;
  insert into public.audit_findings as f (org_id, key, kind, severity, title, detail, action, requirement_id, business_id, location_id, vehicle_id, person_id, type_code, fingerprint)
  select p_org, n.key, n.kind, n.severity, n.title, n.detail, n.action, n.requirement_id, n.business_id, n.location_id, n.vehicle_id, n.person_id, n.type_code, n.fingerprint
  from pp_audit_now n
  on conflict (org_id, key) do update set kind = excluded.kind, severity = excluded.severity, title = excluded.title, detail = excluded.detail,
    action = excluded.action, type_code = excluded.type_code, last_seen_at = now(),
    status = case when f.status = 'dismissed' and f.fingerprint = excluded.fingerprint and excluded.severity <> 'fix' then 'dismissed' else 'open' end,
    closed_at = case when f.status = 'dismissed' and f.fingerprint = excluded.fingerprint and excluded.severity <> 'fix' then f.closed_at else null end,
    closed_by = case when f.status = 'dismissed' and f.fingerprint = excluded.fingerprint and excluded.severity <> 'fix' then f.closed_by else null end,
    first_seen_at = case when f.status = 'open' then f.first_seen_at else now() end,
    fingerprint = excluded.fingerprint;
  update public.audit_findings f set status = 'fixed', closed_at = now(), closed_by = null
  where f.org_id = p_org and f.status = 'open' and not exists (select 1 from pp_audit_now n where n.key = f.key);
  -- a dismissed one whose problem is gone is simply gone
  update public.audit_findings f set status = 'fixed'
  where f.org_id = p_org and f.status = 'dismissed' and not exists (select 1 from pp_audit_now n where n.key = f.key);
  insert into public.audit_runs (org_id, trigger, fix, confirm, soon, items, in_order)
  select p_org, case when p_trigger in ('daily','open','start','manual') then p_trigger else 'daily' end,
    count(*) filter (where f.status = 'open' and f.severity = 'fix'),
    count(*) filter (where f.status = 'open' and f.severity = 'confirm'),
    count(*) filter (where f.status = 'open' and f.severity = 'soon'),
    (select count(*) from public.requirement_status rs left join public.people p on p.id = rs.person_id where rs.org_id = p_org and (rs.person_id is null or p.paused_at is null)),
    (select count(*) from public.requirement_status rs left join public.people p on p.id = rs.person_id where rs.org_id = p_org and (rs.person_id is null or p.paused_at is null)
       and (rs.status = 'compliant' or (rs.status = 'in_progress' and coalesce(rs.days_left, 0) >= 0)))
  from public.audit_findings f where f.org_id = p_org
  returning jsonb_build_object('ran_at', ran_at, 'fix', fix, 'confirm', confirm, 'soon', soon, 'items', items, 'in_order', in_order) into v;
  return v;
end $$;

-- Opening the check (anyone in the workspace). Free workspaces see the counts; Plus shows the details.
create or replace function public.run_permit_check(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_last public.audit_runs;
begin
  if p_org not in (select private.my_org_ids()) then raise exception 'Workspace not found.' using errcode = '42501'; end if;
  select * into v_last from public.audit_runs where org_id = p_org order by ran_at desc limit 1;
  if v_last.id is not null and v_last.ran_at > now() - interval '20 seconds' then
    v := jsonb_build_object('ran_at', v_last.ran_at, 'fix', v_last.fix, 'confirm', v_last.confirm, 'soon', v_last.soon, 'items', v_last.items, 'in_order', v_last.in_order);
  else
    v := private.run_audit(p_org, 'open');
  end if;
  return v || jsonb_build_object('plus', private.has_plus(p_org));
end $$;

-- "It's right" / "Doesn't apply" (questions only; facts close when fixed), and undo.
create or replace function public.dismiss_finding(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.audit_findings;
begin
  select * into f from public.audit_findings where id = p_id for update;
  if f.id is null or f.org_id not in (select private.my_writable_org_ids()) or not private.has_plus(f.org_id) then raise exception 'Not found.' using errcode = '42501'; end if;
  if f.severity = 'fix' then raise exception 'This one closes by itself once it''s fixed.' using errcode = 'P0001'; end if;
  if f.status <> 'open' then return; end if;
  update public.audit_findings set status = 'dismissed', closed_at = now(), closed_by = auth.uid(), note = nullif(left(btrim(p_note), 300), '') where id = p_id;
end $$;
create or replace function public.reopen_finding(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.audit_findings set status = 'open', closed_at = null, closed_by = null, note = null
  where id = p_id and status = 'dismissed' and org_id in (select private.my_writable_org_ids());
  if not found then raise exception 'Not found.' using errcode = 'P0002'; end if;
end $$;

-- What the photo reader saw on an uploaded image (on the customer's phone), for the check above.
create or replace function public.save_document_reading(p_doc uuid, p_reading jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_exp jsonb; v_kind text;
begin
  if p_reading is null or jsonb_typeof(p_reading) <> 'object' then raise exception 'Nothing to save.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_exp from (
    select e from jsonb_array_elements_text(case when jsonb_typeof(p_reading -> 'expires') = 'array' then p_reading -> 'expires' else '[]'::jsonb end) e
    where e ~ '^\d{4}-\d{2}-\d{2}$' limit 4) x;
  v_kind := case when (p_reading ->> 'kind') ~ '^[a-z0-9_]{2,60}$' then p_reading ->> 'kind' end;
  update public.documents set reading = jsonb_strip_nulls(jsonb_build_object('expires', v_exp, 'kind', v_kind,
      'chars', least(greatest(coalesce((p_reading ->> 'chars')::int, 0), 0), 100000))), read_at = now()
  where id = p_doc and deleted_at is null and org_id in (select private.my_writable_org_ids());
  if not found then raise exception 'Document not found.' using errcode = 'P0002'; end if;
exception when invalid_text_representation then raise exception 'Nothing to save.' using errcode = '22023';
end $$;

-- The report by email: the first one when Plus starts, then on the 1st of each month.
create or replace function private.audit_report(p_org uuid, p_first boolean default false) returns int
language plpgsql security definer set search_path = '' as $$
declare v_app text := private.setting('app_url'); o public.orgs; r public.audit_runs; v_list_html text; v_list_text text; v_n int := 0; m record;
  v_key text := case when p_first then 'auditfirst:' || p_org else 'auditmonth:' || p_org || ':' || to_char(private.today_ph(), 'YYYY-MM') end;
  v_title text; v_sum text;
begin
  select * into o from public.orgs where id = p_org and deleted_at is null;
  if o.id is null then return 0; end if;
  select * into r from public.audit_runs where org_id = p_org order by ran_at desc limit 1;
  if r.id is null then return 0; end if;
  select string_agg('<li style="margin:6px 0"><b>' || private.html_escape(f.title) || '</b><br><span style="color:#6B7585;font-size:13px">' || private.html_escape(f.detail) || '</span></li>', '' order by f.sev, f.title),
         string_agg('- ' || f.title, E'\n' order by f.sev, f.title)
    into v_list_html, v_list_text
  from (select title, detail, case severity when 'fix' then 1 when 'confirm' then 2 else 3 end as sev from public.audit_findings
        where org_id = p_org and status = 'open' order by case severity when 'fix' then 1 when 'confirm' then 2 else 3 end, title limit 12) f;
  v_title := case when p_first then 'Your first permit check: ' else 'Your monthly permit check: ' end || o.name;
  v_sum := r.in_order || ' of ' || r.items || ' in order · ' || r.fix || ' to fix · ' || r.confirm || ' to confirm · ' || r.soon || ' coming up';
  for m in select user_id from public.org_members where org_id = p_org and role in ('owner','admin') loop
    perform private.notify(m.user_id, p_org, 'system', v_title, v_sum, '#/check', null, v_key || ':' || m.user_id, false);
    perform private.queue_email(m.user_id, p_org, 'PermitPal: ' || v_title, v_title,
      '<p style="margin:0 0 10px;font-size:15px"><b>' || private.html_escape(v_sum) || '</b></p>' ||
        case when v_list_html is null then '<p>Nothing needs your attention. Well done.</p>' else '<ul style="padding-left:18px;margin:0">' || v_list_html || '</ul>' end ||
        '<p style="color:#6B7585;font-size:13px">PermitPal checks your own records automatically. It doesn''t verify permits with the government; questions are marked "confirm".</p>',
      v_sum || E'\n' || coalesce(v_list_text, 'Nothing needs your attention.'), '#/check', v_key || ':' || m.user_id || ':mail');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;


-- ---------------------------------------------------------------- 5) ready-to-use templates (Plus)
-- Letters and sworn statements businesses keep needing for permits, filled in from the workspace's own
-- details. Only Plus workspaces get the full text from the database (others see the first lines), and
-- every printout carries "Prepared with PermitPal for <business>". Sworn ones say so: they need a
-- notary. These are general templates, not legal advice.
create table if not exists public.doc_templates (
  code       text primary key check (code ~ '^[a-z0-9_]{2,60}$'),
  title      text not null,
  category   text not null,
  summary    text not null,
  use_when   text not null,
  notarize   boolean not null default false,
  fields     jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  body       text not null,
  sort       int not null default 100,
  version    int not null default 1,
  updated_on date not null default current_date
);
alter table public.doc_templates enable row level security;
revoke all on public.doc_templates from anon, authenticated;

create table if not exists private.template_uses (
  id      bigint generated always as identity primary key,
  org_id  uuid references public.orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  code    text not null,
  used_at timestamptz not null default now()
);

-- Everyone sees the list and the first few lines; the full text is Plus only.
create or replace function public.list_templates() returns table (code text, title text, category text, summary text, use_when text,
  notarize boolean, preview text, sort int, version int)
language sql stable security definer set search_path = '' as $$
  select t.code, t.title, t.category, t.summary, t.use_when, t.notarize,
    array_to_string((string_to_array(regexp_replace(t.body, '\{\{[a-z0-9_]+\}\}', '______', 'g'), E'\n'))[1:7], E'\n'), t.sort, t.version
  from public.doc_templates t order by t.sort, t.title
$$;

create or replace function public.get_template(p_org uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.doc_templates;
begin
  if p_org not in (select private.my_org_ids()) then raise exception 'Workspace not found.' using errcode = '42501'; end if;
  if not private.has_plus(p_org) then raise exception 'Ready-to-use templates come with PermitPal Plus.' using errcode = 'P0001', hint = 'plus'; end if;
  select * into t from public.doc_templates where code = p_code;
  if t.code is null then raise exception 'Template not found.' using errcode = 'P0002'; end if;
  insert into private.template_uses (org_id, user_id, code) values (p_org, auth.uid(), t.code);
  return jsonb_build_object('code', t.code, 'title', t.title, 'body', t.body, 'fields', t.fields, 'notarize', t.notarize, 'version', t.version, 'use_when', t.use_when);
end $$;

-- Field sources the app fills in: business_name, business_address, city, tin, me_name, me_title, me_email,
-- today, permit_name, permit_no, permit_issuer, permit_issued, page_link, permits_list. Everything else is typed.
insert into public.doc_templates (code, title, category, summary, use_when, notarize, sort, fields, body) values
('authorization_letter', 'Authorization letter', 'Letters',
 'Lets someone file, pay for and claim a permit for your business.',
 'When an employee, liaison or relative goes to the city hall, barangay or another office for you. Bring both IDs.',
 false, 10,
 '[{"key":"date","label":"Date","source":"today"},
   {"key":"office","label":"Office","hint":"e.g. Business Permits and Licensing Office","required":true},
   {"key":"city","label":"City or municipality","source":"city"},
   {"key":"owner_name","label":"Your name","source":"me_name","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title","hint":"e.g. Owner, President"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address"},
   {"key":"rep_name","label":"Person you authorize","required":true},
   {"key":"rep_id","label":"Their ID","hint":"e.g. Driver''s License No. N01-23-456789"},
   {"key":"permit_name","label":"Permit or document","source":"permit_name","required":true},
   {"key":"valid_until","label":"Valid until","hint":"e.g. 31 March 2027"}]',
$t${{date}}

{{office}}
{{city}}

To whom it may concern:

I, {{owner_name}}, {{owner_title}} of {{business_name}}, with business address at {{business_address}}, authorize {{rep_name}}, holder of {{rep_id}}, to process, pay for and claim the {{permit_name}} of {{business_name}} on our behalf.

This covers filing the application, paying the fees, signing the acknowledgment receipt and claiming the document. This authorization is valid until {{valid_until}}.

Attached are copies of my valid ID and the valid ID of my representative.

Thank you.

Respectfully,


_____________________________
{{owner_name}}
{{owner_title}}, {{business_name}}


Specimen signature of {{rep_name}}:

_____________________________$t$),

('special_power_of_attorney', 'Special Power of Attorney (permits)', 'Sworn and notarized',
 'Gives someone authority to handle your permits and licences for a set period.',
 'When an office asks for an SPA instead of an authorization letter, or someone will handle many permits for you. Sign in front of a notary.',
 true, 20,
 '[{"key":"owner_name","label":"Your full name","source":"me_name","required":true},
   {"key":"owner_address","label":"Your home address","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title","hint":"e.g. Owner, President"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"rep_name","label":"Your attorney-in-fact (the person you appoint)","required":true},
   {"key":"rep_address","label":"Their address","required":true},
   {"key":"permits","label":"Permits covered","hint":"e.g. Business Permit, Barangay Clearance, Fire Safety Inspection Certificate","required":true},
   {"key":"offices","label":"Offices","hint":"e.g. the City of Pasig, its barangays and the Bureau of Fire Protection","required":true},
   {"key":"valid_until","label":"Valid until","hint":"e.g. 31 December 2027","required":true},
   {"key":"owner_id","label":"Your ID for the notary","hint":"e.g. Passport No. P1234567A"},
   {"key":"rep_id","label":"Their ID for the notary"}]',
$t$SPECIAL POWER OF ATTORNEY

KNOW ALL PERSONS BY THESE PRESENTS:

I, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, {{owner_title}} of {{business_name}}, name, constitute and appoint {{rep_name}}, of legal age, Filipino, with address at {{rep_address}}, as my true and lawful attorney-in-fact, for me and in my name, place and stead, to do the following:

1. To file, process, follow up and claim the applications for the issuance and renewal of the permits, licences, clearances and certificates of {{business_name}}, including {{permits}}, with {{offices}};

2. To sign, submit and receive the application forms, sworn declarations, acknowledgment receipts and other documents needed for the above;

3. To pay the fees and charges for the above and receive the official receipts; and

4. To do all other acts needed to carry out the above.

I give my attorney-in-fact full power and authority to do every act necessary for the above as fully as I could if personally present, and I confirm all that my attorney-in-fact lawfully does under this power. This Special Power of Attorney is valid until {{valid_until}}, unless I revoke it earlier in writing.

IN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.


_____________________________
{{owner_name}}
Principal


_____________________________
{{rep_name}}
Attorney-in-fact


Signed in the presence of:

_____________________________          _____________________________


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES )
______________________________ ) S.S.

Before me, a Notary Public for and in ______________, on ______________, personally appeared:

{{owner_name}}, with {{owner_id}}
{{rep_name}}, with {{rep_id}}

known to me to be the same persons who signed the foregoing Special Power of Attorney, consisting of ___ pages including this page, and who acknowledged that it is their free and voluntary act and deed.

WITNESS MY HAND AND SEAL on the date and place first written above.

Doc. No. _____;
Page No. _____;
Book No. _____;
Series of _____.$t$),

('secretary_certificate', 'Secretary''s Certificate (board authority)', 'Sworn and notarized',
 'Shows a corporation''s board authorized someone to handle its permits.',
 'For corporations, when an office asks proof that the person signing may act for the company. The corporate secretary signs it in front of a notary.',
 true, 30,
 '[{"key":"secretary_name","label":"Corporate secretary''s name","required":true},
   {"key":"business_name","label":"Corporation name","source":"business_name","required":true},
   {"key":"business_address","label":"Principal office","source":"business_address","required":true},
   {"key":"sec_no","label":"SEC registration no.","required":true},
   {"key":"meeting_date","label":"Date of the board meeting","hint":"e.g. 15 January 2027","required":true},
   {"key":"permits","label":"Permits covered","hint":"e.g. Business Permit, Fire Safety Inspection Certificate and Sanitary Permit","required":true},
   {"key":"rep_name","label":"Person authorized","required":true},
   {"key":"rep_position","label":"Their position","hint":"e.g. Operations Manager","required":true},
   {"key":"secretary_id","label":"Secretary''s ID for the notary"}]',
$t$SECRETARY'S CERTIFICATE

I, {{secretary_name}}, of legal age, Filipino, with office address at {{business_address}}, after having been sworn in accordance with law, certify that:

1. I am the Corporate Secretary of {{business_name}} (the "Corporation"), a corporation organized and existing under Philippine law, with SEC Registration No. {{sec_no}} and principal office at {{business_address}}.

2. At the meeting of the Board of Directors of the Corporation held on {{meeting_date}}, at which a quorum was present and acting throughout, the following resolutions were approved:

"RESOLVED, that the Corporation apply for, renew and secure its permits, licences, clearances and certificates with government offices, including {{permits}};

RESOLVED FURTHER, that {{rep_name}}, {{rep_position}}, is authorized to sign, file and receive, for and on behalf of the Corporation, all documents needed for the foregoing, to pay the corresponding fees, and to do all acts necessary to carry out these resolutions."

3. These resolutions have not been revoked, amended or modified and remain in full force and effect.

IN WITNESS WHEREOF, I have signed this certificate on ______________ at ______________, Philippines.


_____________________________
{{secretary_name}}
Corporate Secretary


SUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{secretary_id}} as competent evidence of identity.

Doc. No. _____;
Page No. _____;
Book No. _____;
Series of _____.$t$),

('affidavit_of_loss', 'Affidavit of Loss', 'Sworn and notarized',
 'For a lost permit, certificate, official receipt or registration paper.',
 'When you need a replacement or certified copy of a lost document. Most offices ask for this first. Sign in front of a notary.',
 true, 40,
 '[{"key":"owner_name","label":"Your full name","source":"me_name","required":true},
   {"key":"owner_address","label":"Your home address","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address"},
   {"key":"lost_document","label":"Document lost","source":"permit_name","required":true},
   {"key":"lost_no","label":"Its number","source":"permit_no","hint":"Leave blank if unknown"},
   {"key":"issuer","label":"Issued by","source":"permit_issuer","hint":"e.g. City of Makati","required":true},
   {"key":"where_kept","label":"Where it was kept","hint":"e.g. the office cabinet at our main branch","required":true},
   {"key":"lost_date","label":"When you found it missing","hint":"e.g. 3 March 2027","required":true},
   {"key":"owner_id","label":"Your ID for the notary"}]',
$t$REPUBLIC OF THE PHILIPPINES )
______________________________ ) S.S.

AFFIDAVIT OF LOSS

I, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, after having been sworn in accordance with law, state that:

1. I am the {{owner_title}} of {{business_name}}, with business address at {{business_address}};

2. {{business_name}} was issued a {{lost_document}}, No. {{lost_no}}, by {{issuer}};

3. The document was kept at {{where_kept}};

4. On or about {{lost_date}}, I discovered that the document was missing. Despite diligent efforts to find it, it could not be found, and it is now considered lost;

5. The document has not been sold, pledged or used as security for any obligation, nor used for any unlawful purpose; and

6. I am signing this affidavit to attest to the truth of the above and to support the request for a replacement or certified true copy of the document, and for whatever lawful purpose it may serve.

IN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.


_____________________________
{{owner_name}}
Affiant


SUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.

Doc. No. _____;
Page No. _____;
Book No. _____;
Series of _____.$t$),

('gross_sales_declaration', 'Sworn declaration of gross sales', 'Sworn and notarized',
 'Your declared sales for the year, for the business permit renewal.',
 'For the January business permit renewal. Many cities have their own form: if yours does, use theirs and keep this as your worksheet.',
 true, 50,
 '[{"key":"office","label":"Office","hint":"e.g. Business Permits and Licensing Office","required":true},
   {"key":"city","label":"City or municipality","source":"city","required":true},
   {"key":"owner_name","label":"Your full name","source":"me_name","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address","required":true},
   {"key":"tin","label":"TIN","source":"tin"},
   {"key":"line_of_business","label":"Line of business","hint":"e.g. restaurant","required":true},
   {"key":"sales_year","label":"Year of the sales","hint":"e.g. 2026","required":true},
   {"key":"gross_sales","label":"Gross sales or receipts (₱)","hint":"e.g. 2,450,000.00","required":true},
   {"key":"permit_year","label":"Permit year","hint":"e.g. 2027","required":true},
   {"key":"owner_id","label":"Your ID for the notary"}]',
$t$SWORN DECLARATION OF GROSS SALES / RECEIPTS

{{office}}
{{city}}

I, {{owner_name}}, of legal age, Filipino, {{owner_title}} of {{business_name}}, with business address at {{business_address}} and TIN {{tin}}, after having been sworn in accordance with law, declare that:

1. The gross sales / receipts of {{business_name}} from its {{line_of_business}} business for calendar year {{sales_year}} amounted to PHP {{gross_sales}}, as shown in its books of accounts and in the returns it filed with the Bureau of Internal Revenue; and

2. I am making this declaration to support the renewal of the business permit of {{business_name}} for {{permit_year}}. I understand that a false declaration may lead to penalties, surcharges and the revocation of the permit under the local revenue code.

IN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.


_____________________________
{{owner_name}}
Affiant


SUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.

Doc. No. _____;
Page No. _____;
Book No. _____;
Series of _____.$t$),

('certified_copy_request', 'Request for a certified true copy', 'Letters',
 'Asks an office for a certified copy of a permit or certificate it issued.',
 'When a client, bank or another office wants a certified copy, or the original is damaged. If the original was lost, add an Affidavit of Loss.',
 false, 60,
 '[{"key":"date","label":"Date","source":"today"},
   {"key":"office_head","label":"Addressed to","hint":"e.g. The City Treasurer","required":true},
   {"key":"office","label":"Office","source":"permit_issuer","required":true},
   {"key":"office_address","label":"Office address"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address"},
   {"key":"copies","label":"Number of copies","hint":"e.g. two (2)","required":true},
   {"key":"document_name","label":"Document","source":"permit_name","required":true},
   {"key":"doc_no","label":"Its number","source":"permit_no"},
   {"key":"issued_on","label":"Date issued","source":"permit_issued"},
   {"key":"purpose","label":"What it''s for","hint":"e.g. a supplier accreditation","required":true},
   {"key":"rep_name","label":"Who will receive it","required":true},
   {"key":"contact","label":"Your phone or email","source":"me_email"},
   {"key":"owner_name","label":"Your name","source":"me_name","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"}]',
$t${{date}}

{{office_head}}
{{office}}
{{office_address}}

Dear Sir or Madam:

On behalf of {{business_name}}, with business address at {{business_address}}, I request {{copies}} certified true copies of our {{document_name}}, No. {{doc_no}}, issued on {{issued_on}}.

We need the certified copies for {{purpose}}. We will pay the certification fees upon your advice.

Our representative, {{rep_name}}, will receive the documents on our behalf. Attached are a copy of the document, if available, and a valid ID.

You may reach me at {{contact}}.

Thank you very much.

Respectfully,


_____________________________
{{owner_name}}
{{owner_title}}, {{business_name}}$t$),

('landlord_letter', 'Letter to your landlord for permit papers', 'Letters',
 'Asks the property owner for the papers the city needs from them.',
 'Before a business permit renewal, when the city asks for the lease, the owner''s consent or the property''s tax receipt.',
 false, 70,
 '[{"key":"date","label":"Date","source":"today"},
   {"key":"landlord_name","label":"Landlord''s name","required":true},
   {"key":"landlord_address","label":"Landlord''s address"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"unit","label":"What you lease","hint":"e.g. Unit 3, ground floor","required":true},
   {"key":"business_address","label":"Business address","source":"business_address","required":true},
   {"key":"office","label":"Which office asks","hint":"e.g. the Business Permits and Licensing Office of Quezon City","required":true},
   {"key":"documents_needed","label":"Papers needed","multiline":true,"required":true,
    "default":"1. A copy of our lease contract\n2. The property owner''s consent to use the space for our business, if required\n3. A copy of the current real property tax receipt, if required"},
   {"key":"needed_by","label":"Needed by","hint":"e.g. 10 January 2027","required":true},
   {"key":"contact","label":"Your phone or email","source":"me_email"},
   {"key":"owner_name","label":"Your name","source":"me_name","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"}]',
$t${{date}}

{{landlord_name}}
{{landlord_address}}

Dear {{landlord_name}}:

We are renewing the permits of {{business_name}}, which leases {{unit}} at {{business_address}}. {{office}} asks us to submit the following papers from the property owner:

{{documents_needed}}

May we ask for copies of these by {{needed_by}}? We can pick them up from you, or receive them by email at {{contact}}.

Thank you for your help. Please let me know if you need anything from us.

Sincerely,


_____________________________
{{owner_name}}
{{owner_title}}, {{business_name}}$t$),

('accreditation_cover_letter', 'Cover letter for vendor accreditation', 'Letters',
 'Sends your permits to a client that wants to accredit you as a supplier.',
 'When a company, mall or government office asks for your permits before buying from you. Attach the accreditation pack from Share proof.',
 false, 80,
 '[{"key":"date","label":"Date","source":"today"},
   {"key":"client_contact","label":"Addressed to","hint":"e.g. Ms. Ana Reyes, Purchasing","required":true},
   {"key":"client_company","label":"Company","required":true},
   {"key":"client_address","label":"Company address"},
   {"key":"business_name","label":"Your business name","source":"business_name","required":true},
   {"key":"documents_list","label":"Documents enclosed","source":"permits_list","multiline":true,"required":true},
   {"key":"page_link","label":"Your public permit page","source":"page_link"},
   {"key":"contact","label":"Your phone or email","source":"me_email"},
   {"key":"owner_name","label":"Your name","source":"me_name","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"}]',
$t${{date}}

{{client_contact}}
{{client_company}}
{{client_address}}

Subject: Accreditation documents of {{business_name}}

Dear {{client_contact}}:

Thank you for considering {{business_name}} as your supplier. Enclosed are our accreditation documents:

{{documents_list}}

You can also check the current status of our permits at any time here: {{page_link}}. The page is kept up to date and shows each permit's validity.

Please let me know if you need anything else. You can reach me at {{contact}}.

Sincerely,


_____________________________
{{owner_name}}
{{owner_title}}, {{business_name}}$t$)
on conflict (code) do update set title = excluded.title, category = excluded.category, summary = excluded.summary, use_when = excluded.use_when,
  notarize = excluded.notarize, sort = excluded.sort, fields = excluded.fields, body = excluded.body,
  version = public.doc_templates.version + case when public.doc_templates.body <> excluded.body then 1 else 0 end, updated_on = current_date;


-- ---------------------------------------------------------------- 6) online checkout for these bills (no change to the checkout function)
-- The app asks create-checkout for plan "addon:<bill id>"; billing_start hands it the bill's amount.
create or replace function private.addon_payment_start(p_org uuid, p_plan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.addon_invoices; v_id uuid;
begin
  if p_plan !~ '^addon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Unknown bill.' using errcode = '22023'; end if;
  select * into i from public.addon_invoices where id = substr(p_plan, 7)::uuid;
  if i.id is null or i.org_id is distinct from p_org or not private.is_org_admin(p_org) then raise exception 'Bill not found.' using errcode = '42501'; end if;
  if i.status <> 'due' then raise exception 'This bill is already paid or was replaced.' using errcode = 'P0001'; end if;
  if i.valid_until < private.today_ph() then raise exception 'This bill has expired. Choose your plan again to get a new one.' using errcode = 'P0001'; end if;
  if i.amount_php < 20 then raise exception 'Online checkout needs at least ₱20. Pay this one by GCash or bank transfer.' using errcode = 'P0001'; end if;
  insert into public.payments (org_id, plan_id, months, amount_php, created_by, addon_invoice_id)
  values (p_org, null, i.months, i.amount_php, auth.uid(), i.id) returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'amount_php', i.amount_php,
    'plan_name', regexp_replace(private.addon_label(i.kind, i.people_max, i.billing), '^PermitPal ', '') ||
      case when i.credit_php > 0 then ', less ' || private.peso(i.credit_php) || ' unused' else '' end,
    'months', i.months, 'org_name', (select name from public.orgs where id = p_org), 'email', (select email from public.profiles where id = auth.uid()));
end $$;

-- ---------------------------------------------------------------- 7) every morning
create or replace function private.plus_daily() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_n int := 0; a record; v_inv public.addon_invoices; v_people int; v_paused int; o record;
begin
  -- unpaid bills past their date
  update public.addon_invoices set status = 'cancelled', note = 'Not paid in time. Choose your plan again for a new bill.'
  where status = 'due' and valid_until < v_today;
  -- plans set to stop: forget the stop once the period is over
  delete from private.addon_stops where stop_after < v_today;

  -- the next period's bill, 7 days ahead (not for trials, gifts, plans set to stop, or Plus inside a team plan)
  for a in
    select ad.*, private.addon_label(ad.kind, coalesce(ad.next_people_max, ad.people_max), coalesce(ad.next_billing, ad.billing)) as label
    from public.addons ad join public.orgs og on og.id = ad.org_id and og.deleted_at is null
    where not ad.trial and not ad.comped and ad.paid_through between v_today and v_today + 7
      and not exists (select 1 from private.addon_stops s where s.org_id = ad.org_id and s.kind = ad.kind)
      and not exists (select 1 from public.addon_invoices i where i.org_id = ad.org_id and i.kind = ad.kind
                      and i.status in ('due','pending_verification') and i.period_start > ad.paid_through)
      and not (ad.kind = 'plus' and og.kind <> 'business' and private.effective_plan_id(og.id) in ('fleet','firm','head_office','property'))
  loop
    insert into public.addon_invoices (number, org_id, kind, people_max, billing, months, price_php, credit_php, amount_php, period_start, period_end, renewal, valid_until, created_by)
    values (private.next_no('PPA'), a.org_id, a.kind, case when a.kind = 'staff' then coalesce(a.next_people_max, a.people_max) end,
      coalesce(a.next_billing, a.billing), case coalesce(a.next_billing, a.billing) when 'yearly' then 12 else 1 end,
      private.addon_price(a.kind, coalesce(a.next_people_max, a.people_max), coalesce(a.next_billing, a.billing)), 0,
      private.addon_price(a.kind, coalesce(a.next_people_max, a.people_max), coalesce(a.next_billing, a.billing)),
      a.paid_through + 1, (a.paid_through + 1 + make_interval(months => case coalesce(a.next_billing, a.billing) when 'yearly' then 12 else 1 end))::date - 1,
      true, a.paid_through + 14, null)
    returning * into v_inv;
    perform private.notify_owners(a.org_id, a.label || ' renews on ' || private.fmt_date(a.paid_through + 1) || ': ' || private.peso(v_inv.amount_php),
      'Bill ' || v_inv.number || '. Pay by ' || private.fmt_date(a.paid_through) || ' to keep it on without a break: GCash, Maya, bank or card, under Settings > Plan.',
      '#/settings/billing', 'addonrenew:' || v_inv.id, true, true);
    v_n := v_n + 1;
  end loop;

  -- the last day of an unpaid period
  for a in select i.*, private.addon_label(i.kind, i.people_max, i.billing) as label from public.addon_invoices i
      where i.status = 'due' and i.renewal and i.period_start = v_today + 1 loop
    perform private.notify_owners(a.org_id, 'Last day: ' || a.label || ' ends today',
      'Pay bill ' || a.number || ' (' || private.peso(a.amount_php) || ') today to keep it on. Your records are safe either way.',
      '#/settings/billing', 'addonlast:' || a.id, true, true);
  end loop;

  -- free trial ending soon / ended
  for a in select ad.* from public.addons ad join public.orgs og on og.id = ad.org_id and og.deleted_at is null
      where ad.kind = 'plus' and ad.trial and ad.paid_through in (v_today + 2, v_today - 1) loop
    perform private.notify_owners(a.org_id,
      case when a.paid_through >= v_today then 'Your Plus trial ends on ' || private.fmt_date(a.paid_through) else 'Your Plus trial has ended' end,
      case when a.paid_through >= v_today then 'Keep your public permit page, monthly permit check and templates for ₱199 a month (or ₱1,990 a year).'
           else 'Your public permit page now shows "paused" and the monthly check has stopped. Your records are safe. Turn Plus on again anytime.' end,
      '#/settings/billing', 'plustrial:' || a.org_id || ':' || a.paid_through || ':' || case when a.paid_through >= v_today then 'soon' else 'ended' end, true, true);
  end loop;

  -- paid or given plans that ended yesterday
  for a in select ad.* from public.addons ad join public.orgs og on og.id = ad.org_id and og.deleted_at is null
      where not ad.trial and ad.paid_through = v_today - 1 loop
    v_people := private.active_people(a.org_id);
    perform private.notify_owners(a.org_id,
      case when a.kind = 'plus' then 'PermitPal Plus has ended' else 'Your staff licences have ended' end,
      case when a.kind = 'plus' then 'Your public permit page now shows "paused" and the monthly check has stopped. Your records are safe. Turn it on again under Settings > Plan.'
           else 'Reminders for ' || greatest(v_people - private.free_people(), 0) || ' of your ' || v_people || ' people are paused (the first ' || private.free_people() ||
                ' stay free). Nothing was deleted. Add licences under Settings > Plan to turn them back on.' end,
      '#/settings/billing', 'addonend:' || a.org_id || ':' || a.kind || ':' || a.paid_through, true, true);
  end loop;

  -- people above what's paid for pause; paid-for people wake up
  for o in select p.org_id from public.people p where p.deleted_at is null or p.paused_at is not null
      group by p.org_id having count(*) filter (where p.deleted_at is null) > private.free_people() or bool_or(p.paused_at is not null) loop
    v_paused := private.sync_people(o.org_id);
  end loop;

  -- the permit check, every morning for Plus; the report on the 1st
  for o in select og.id from public.orgs og where og.deleted_at is null and private.has_plus(og.id) loop
    perform private.run_audit(o.id, 'daily');
    if extract(day from v_today) = 1 then v_n := v_n + private.audit_report(o.id, false); end if;
  end loop;

  v_n := v_n + private.worker_reminders();
  v_n := v_n + private.trust_updates();

  -- keep a little over a year of history
  delete from public.trust_page_views where viewed_at < now() - interval '400 days';
  delete from public.audit_runs r where r.ran_at < now() - interval '400 days';
  delete from public.audit_findings where status in ('fixed','dismissed') and closed_at < now() - interval '400 days';
  delete from private.template_uses where used_at < now() - interval '400 days';
  return v_n;
end $$;

-- ---------------------------------------------------------------- 8) changes to earlier functions

-- Online checkout: a bill for Plus or staff licences is passed as plan "addon:<bill id>".
CREATE OR REPLACE FUNCTION public.billing_start(p_org uuid, p_plan text, p_months integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.plans;
  v_id uuid;
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
  insert into public.payments (org_id, plan_id, months, amount_php, created_by)
  values (p_org, p_plan, p_months, v_plan.price_php_monthly * p_months, auth.uid()) returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'amount_php', v_plan.price_php_monthly * p_months,
    'plan_name', v_plan.name, 'months', p_months,
    'org_name', (select name from public.orgs where id = p_org),
    'email', (select email from public.profiles where id = auth.uid()));
end $function$;

-- A paid online checkout for those bills switches the plan on.
CREATE OR REPLACE FUNCTION public.billing_mark_paid(p_checkout_id text, p_raw jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pay public.payments;
  v_org public.orgs;
  v_from timestamptz;
  v_owner record;
begin
  select * into v_pay from public.payments where checkout_id = p_checkout_id for update;
  if v_pay.id is null or v_pay.status = 'paid' then return; end if;
  update public.payments set status = 'paid', paid_at = now(), raw = p_raw where id = v_pay.id;
  if v_pay.addon_invoice_id is not null then
    perform private.addon_paid(v_pay.addon_invoice_id, 'online', p_checkout_id, private.today_ph());
    return;
  end if;
  if v_pay.request_id is not null then
    update public.assistance_requests set payment_status = 'paid', payment_method = 'paymongo', payment_ref = p_checkout_id, paid_at = now(),
      status = case when status in ('quoted','awaiting_customer','submitted') then 'in_progress' else status end
    where id = v_pay.request_id;
    perform private.order_event(v_pay.request_id, 'payment', 'Paid online - PHP ' || to_char(v_pay.amount_php, 'FM999,999,990.00') || '. Work has started.');
    perform private.notify_admins('Paid online: request', 'PHP ' || to_char(v_pay.amount_php, 'FM999,999,990.00'), 'orderpaid:' || v_pay.id, true);
    return;
  end if;
  select * into v_org from public.orgs where id = v_pay.org_id for update;
  v_from := case when v_org.plan_id = v_pay.plan_id and v_org.plan_expires_at > now() then v_org.plan_expires_at else now() end;
  update public.orgs set plan_id = v_pay.plan_id, plan_expires_at = v_from + make_interval(months => v_pay.months) where id = v_org.id;
  for v_owner in select user_id from public.org_members where org_id = v_org.id and role = 'owner' loop
    perform private.notify(v_owner.user_id, v_org.id, 'billing', 'Payment received - thank you!',
      'Your ' || (select name from public.plans where id = v_pay.plan_id) || ' plan is active until ' ||
      private.fmt_date(((v_from + make_interval(months => v_pay.months)) at time zone 'Asia/Manila')::date) || '.',
      '#/settings/billing', null, 'paid:' || v_pay.id, true);
  end loop;
end $function$;

-- Reminders skip people paused because the staff licences don't cover them.
CREATE OR REPLACE FUNCTION private.queue_due_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := private.today_ph();
  v_app   text := private.setting('app_url');
  v_new   int := 0;
begin
  -- 1. One in-app notification per permit period, reminder stage and person.
  --    Stages: 30 days, 7 days, 1 day before, then weekly while overdue. Missing a day
  --    never skips a reminder: the most urgent stage not yet sent goes out next run.
  --    A permit someone is handling reminds only that person; others remind everyone who can edit.
  with items as (
    select rs.*,
      coalesce(rs.subject_name, '') ||
        case when rs.location_name is not null and not coalesce(rs.location_is_main, true) then ' (' || rs.location_name || ')' else '' end ||
        case when rs.plate_no is not null and rs.plate_no <> '' then ' - ' || rs.plate_no else '' end as label
    from public.requirement_status rs
    join public.orgs o on o.id = rs.org_id and o.deleted_at is null
    where rs.expires and rs.expires_on is not null and rs.days_left <= 30
      and not exists (select 1 from public.people pp where pp.id = rs.person_id and pp.paused_at is not null)
      and (rs.status <> 'in_progress' or rs.days_left < 0)
  ), targets as (
    select i.*, m.user_id,
      case
        when i.days_left < 0 then 'overdue-' || ((-i.days_left - 1) / 7)
        when i.days_left <= 1 and np.remind_1 then 'd1'
        when i.days_left <= 7 and np.remind_7 then 'd7'
        when i.days_left <= 30 and np.remind_30 then 'd30'
      end as stage
    from items i
    join public.org_members m on m.org_id = i.org_id and m.role <> 'viewer' and (i.assignee_id is null or m.user_id = i.assignee_id)
    join public.notification_prefs np on np.user_id = m.user_id
    where (i.subject in ('business','person') and np.business_alerts) or (i.subject = 'vehicle' and np.vehicle_alerts)
  ), inserted as (
    insert into public.notifications (user_id, org_id, kind, title, body, link, requirement_id, dedupe_key)
    select t.user_id, t.org_id,
      case when t.days_left < 0 then 'overdue' else 'due_soon' end,
      t.name || ' ' || private.due_phrase(t.days_left),
      t.label || ' - due ' || private.fmt_date(t.expires_on),
      '#/requirement/' || t.id, t.id,
      'rem:' || t.cycle_id || ':' || t.stage || ':' || t.user_id
    from targets t where t.stage is not null
    on conflict (dedupe_key) do nothing
    returning user_id, org_id, title, body, link, kind
  ), grouped as (
    -- 2. One message per person per workspace per day, listing everything new.
    select i.user_id, i.org_id, count(*) as n,
      string_agg('<li style="margin:6px 0">' || private.html_escape(i.title) || '<br><span style="color:#6B7585;font-size:13px">'
                 || private.html_escape(i.body) || '</span></li>', '' order by i.kind, i.title) as items_html,
      string_agg('- ' || i.title || ' (' || i.body || ')', E'\n' order by i.kind, i.title) as items_text,
      (array_agg(i.title order by i.kind, i.title))[1] as first_title
    from inserted i group by i.user_id, i.org_id
  ), recipients as (
    select g.*, p.email, p.phone, p.first_name, o.name as org_name,
      coalesce(np.email_enabled, true) as email_on, coalesce(np.sms_enabled, false) as sms_on,
      coalesce(np.whatsapp_enabled, false) as wa_on,
      coalesce((select pl.paid_channels from public.plans pl where pl.id = private.effective_plan_id(g.org_id)), false) as paid
    from grouped g
    join public.profiles p on p.id = g.user_id
    join public.orgs o on o.id = g.org_id
    left join public.notification_prefs np on np.user_id = g.user_id
  ), msgs as (
    select r.org_id, r.user_id, 'email' as channel, r.email as to_address,
      case when r.n = 1 then 'PermitPal: ' || r.first_title else 'PermitPal: ' || r.n || ' items need attention (' || r.org_name || ')' end as subject,
      'These need attention in ' || r.org_name || E':\n' || r.items_text || E'\n\nOpen PermitPal: ' || v_app as body_text,
      private.email_html(case when r.n = 1 then r.first_title else r.n || ' items need attention' end,
        '<p style="margin:0 0 8px">In <b>' || private.html_escape(r.org_name) || '</b>:</p><ul style="padding-left:18px;margin:0">' || r.items_html || '</ul>',
        'Open PermitPal', v_app) as body_html,
      null::text as template, null::jsonb as template_params,
      'remmail:' || r.user_id || ':' || r.org_id || ':' || v_today as dedupe_key
    from recipients r where r.email_on and r.email is not null
    union all
    select r.org_id, r.user_id, 'sms', r.phone, null,
      left('PermitPal: ' || r.first_title || case when r.n > 1 then ' +' || (r.n - 1) || ' more' else '' end || '. ' || v_app, 300),
      null, null, null,
      'remsms:' || r.user_id || ':' || r.org_id || ':' || v_today
    from recipients r where r.sms_on and r.paid and r.phone is not null
    union all
    select r.org_id, r.user_id, 'whatsapp', r.phone, null,
      r.first_title || case when r.n > 1 then ' +' || (r.n - 1) || ' more' else '' end,
      null, 'permit_reminder',
      jsonb_build_array(coalesce(nullif(r.first_name, ''), 'there'), r.n::text, r.first_title, v_app),
      'remwa:' || r.user_id || ':' || r.org_id || ':' || v_today
    from recipients r where r.wa_on and r.paid and r.phone is not null
  )
  insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, template, template_params, dedupe_key)
  select * from msgs
  on conflict (dedupe_key) do nothing;
  get diagnostics v_new = row_count;

  -- 1b. Escalations to owners/admins for permits someone else is handling.
  perform private.queue_escalations();

  -- 3. Monday weekly digest (email only): a summary of everything not compliant.
  if extract(isodow from v_today) = 1 then
    insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    select d.org_id, d.user_id, 'email', d.email,
      'PermitPal weekly summary: ' || d.org_name,
      d.overdue || ' overdue, ' || d.soon || ' due within 30 days, ' || d.needinfo || ' need information, ' || d.inprog || ' in progress. ' || v_app,
      private.email_html('Your week in compliance: ' || d.org_name,
        '<table style="width:100%;border-collapse:collapse;font-size:14px">'
        || '<tr><td style="padding:6px 0">Overdue</td><td style="text-align:right;font-weight:700;color:#D8433C">' || d.overdue || '</td></tr>'
        || '<tr><td style="padding:6px 0">Due within 30 days</td><td style="text-align:right;font-weight:700;color:#DF9A1F">' || d.soon || '</td></tr>'
        || '<tr><td style="padding:6px 0">Need information</td><td style="text-align:right;font-weight:700">' || d.needinfo || '</td></tr>'
        || '<tr><td style="padding:6px 0">Renewals in progress</td><td style="text-align:right;font-weight:700;color:#2F6FED">' || d.inprog || '</td></tr>'
        || '<tr><td style="padding:6px 0">Compliant</td><td style="text-align:right;font-weight:700;color:#1D9C57">' || d.ok || '</td></tr></table>',
        'Open PermitPal', v_app),
      'digest:' || d.user_id || ':' || d.org_id || ':' || to_char(v_today, 'IYYY-IW')
    from (
      select m.user_id, m.org_id, p.email, o.name as org_name,
        count(*) filter (where rs.status = 'action_required') as overdue,
        count(*) filter (where rs.status = 'renew_soon') as soon,
        count(*) filter (where rs.status = 'needs_information') as needinfo,
        count(*) filter (where rs.status = 'in_progress') as inprog,
        count(*) filter (where rs.status = 'compliant') as ok
      from public.org_members m
      join public.orgs o on o.id = m.org_id and o.deleted_at is null
      join public.profiles p on p.id = m.user_id
      join public.notification_prefs np on np.user_id = m.user_id and np.weekly_digest and np.email_enabled
      join public.requirement_status rs on rs.org_id = m.org_id
      group by m.user_id, m.org_id, p.email, o.name
    ) d
    where d.email is not null and (d.overdue + d.soon + d.needinfo + d.inprog) > 0
    on conflict (dedupe_key) do nothing;
  end if;

  -- 4. Paid plan about to lapse: tell the owners a week ahead and on the day.
  perform private.notify(m.user_id, o.id, 'billing',
      case when o.plan_expires_at < now() then 'Your ' || pl.name || ' plan has ended'
           else 'Your ' || pl.name || ' plan ends on ' || private.fmt_date((o.plan_expires_at at time zone 'Asia/Manila')::date) end,
      'Renew under Settings > Plan & billing to keep SMS/WhatsApp reminders and your plan limits. Your data stays safe either way.',
      '#/settings/billing', null,
      'plan:' || o.id || ':' || (o.plan_expires_at at time zone 'Asia/Manila')::date || ':' ||
        case when o.plan_expires_at < now() then 'ended' else 'soon' end || ':' || m.user_id)
  from public.orgs o
  join public.plans pl on pl.id = o.plan_id
  join public.org_members m on m.org_id = o.id and m.role = 'owner'
  where o.deleted_at is null and o.plan_expires_at is not null
    and o.plan_expires_at < now() + interval '7 days' and o.plan_expires_at > now() - interval '2 days';

  perform private.flush_outbox();
  return v_new;
end $function$;

-- ...and so do escalations.
CREATE OR REPLACE FUNCTION private.queue_escalations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int := 0; v record;
begin
  for v in
    select rs.id, rs.org_id, rs.cycle_id, rs.name, rs.days_left, rs.expires_on, m.user_id,
      coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email, 'A teammate') as who,
      coalesce(rs.subject_name, '') || case when rs.plate_no is not null and rs.plate_no <> '' then ' - ' || rs.plate_no else '' end as label,
      case when rs.days_left < 0 then 'over-' || ((-rs.days_left - 1) / 7) else 'soon' end as stage
    from public.requirement_status rs
    join public.orgs o on o.id = rs.org_id and o.deleted_at is null
    join public.org_members m on m.org_id = rs.org_id and m.role in ('owner', 'admin') and m.user_id <> rs.assignee_id
    join public.profiles p on p.id = rs.assignee_id
    where rs.assignee_id is not null and rs.expires and rs.expires_on is not null
      and not exists (select 1 from public.people pp where pp.id = rs.person_id and pp.paused_at is not null)
      and (rs.days_left < 0 or (o.escalate_days is not null and rs.days_left <= o.escalate_days and rs.status <> 'in_progress'))
  loop
    perform private.notify(v.user_id, v.org_id, 'escalation',
      case when v.days_left < 0 then 'Overdue: ' else 'Not started yet: ' end || v.name || ' (' || v.label || ')',
      v.who || ' is handling it. ' || case when v.days_left < 0 then 'It was due ' else 'It is due ' end || private.fmt_date(v.expires_on)
        || '. Check in with them, or give it to someone else.',
      '#/requirement/' || v.id, v.id, 'esc:' || v.cycle_id || ':' || v.stage || ':' || v.user_id, true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

-- Money: Plus and staff licences.
CREATE OR REPLACE FUNCTION public.admin_money(p_from date, p_to date)
 RETURNS TABLE(day date, stream text, kind text, state text, amount numeric, label text, who text, ref_kind text, ref_id uuid, invoice_no text, rush numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'Choose a range of up to about 2 years.' using errcode = '22023'; end if;
  return query
  with lines as (
    -- one-time jobs and care renewals: our fee (service + rush), when paid
    select private.ph_day(a.paid_at) as day, 'jobs'::text as stream, 'service_fee'::text as kind, 'collected'::text as state,
      (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric as amount, a.requirement_name as label, o.name as who,
      'order'::text as ref_kind, a.id as ref_id, a.bir_invoice_no as invoice_no, a.quote_rush_fee::numeric as rush
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(a.paid_at), 'jobs', 'gov_fees_in', 'held', coalesce(a.quote_gov_fees, 0)::numeric, a.requirement_name, o.name, 'order', a.id, a.bir_invoice_no, 0::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and coalesce(a.quote_gov_fees, 0) > 0
    union all
    select private.ph_day(coalesce(a.closed_at, a.updated_at)), 'jobs', 'gov_fees_out', 'held', -a.gov_fees_actual::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and coalesce(a.gov_fees_actual, 0) > 0
    union all
    -- refunds: a fee difference is government money going back; a full refund returns our fee first, then the rest
    select private.ph_day(r.created_at), 'jobs', 'refund', 'held', -r.amount_php::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id where r.kind = 'fee_difference'
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'collected', -r.amount_php::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id where r.kind = 'partial'
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'collected', -least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric,
      a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id
    where r.kind = 'full' and least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'held', -(r.amount_php - least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee))::numeric,
      a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id
    where r.kind = 'full' and r.amount_php > coalesce(a.quote_service_fee, 0) + a.quote_rush_fee
    union all
    -- accepted, not paid yet / quoted, not accepted yet
    select private.ph_day(coalesce(a.accepted_at, a.quoted_at, a.created_at)), 'jobs', 'service_fee', 'to_collect',
      (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric, a.requirement_name, o.name, 'order', a.id, null, a.quote_rush_fee::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.payment_status in ('awaiting_payment','pending_verification') and a.status <> 'cancelled' and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(a.quoted_at), 'jobs', 'service_fee', 'pipeline', (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric, a.requirement_name, o.name,
      'order', a.id, null, a.quote_rush_fee::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.status = 'quoted' and a.quoted_at is not null and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    -- year-round care bills
    select private.ph_day(i.paid_at), 'care', 'care_fee', 'collected', i.amount_php::numeric, 'Year-round care, bill ' || i.number, o.name, 'care', i.id, i.bir_invoice_no, 0
    from public.care_invoices i join public.orgs o on o.id = i.org_id where i.status = 'paid' and i.amount_php > 0
    union all
    select i.due_on, 'care', 'care_fee', 'to_collect', i.amount_php::numeric, 'Year-round care, bill ' || i.number, o.name, 'care', i.id, null, 0
    from public.care_invoices i join public.orgs o on o.id = i.org_id where i.status in ('due','pending_verification') and i.amount_php > 0
    union all
    select private.ph_day(g.paid_at), 'care', 'guarantee', 'cost', -g.approved_php::numeric, 'On-time guarantee: ' || g.requirement_name, o.name, 'claim', g.id, null, 0
    from public.guarantee_claims g join public.orgs o on o.id = g.org_id where g.status = 'paid'
    union all
    select private.ph_day(g.decided_at), 'care', 'guarantee', 'to_pay', -g.approved_php::numeric, 'On-time guarantee: ' || g.requirement_name, o.name, 'claim', g.id, null, 0
    from public.guarantee_claims g join public.orgs o on o.id = g.org_id where g.status = 'approved'
    union all
    -- fees from firms, charge by charge
    select case when c.status = 'paid' then coalesce(private.ph_day(s.paid_at), c.occurred_on) else c.occurred_on end, 'partners', c.kind,
      case c.status when 'paid' then 'collected' when 'billed' then 'to_collect' else 'unbilled' end,
      c.amount_php::numeric, c.description, p.name, case when s.id is not null then 'statement' else 'partner' end, coalesce(s.id, p.id), s.bir_invoice_no, 0
    from public.partner_charges c join public.partners p on p.id = c.partner_id left join public.partner_statements s on s.id = c.statement_id
    where c.status <> 'waived'
    union all
    -- prepaid credit firms bought (the money is in when they pay; each quote request then uses some of it)
    select private.ph_day(c.created_at), 'partners', 'credit_topup', 'collected', c.amount_php::numeric, 'Prepaid credit for quote requests', p.name, 'credit', c.id, c.bir_invoice_no, 0
    from public.partner_credits c join public.partners p on p.id = c.partner_id where c.kind = 'topup'
    union all
    -- team plans (online, or recorded by staff)
    select private.ph_day(pm.paid_at), 'plans', 'team_plan', 'collected', pm.amount_php::numeric, pl.name || ' plan, ' || pm.months || ' month' || case when pm.months > 1 then 's' else '' end,
      o.name, 'plan', pm.id, pm.bir_invoice_no, 0
    from public.payments pm join public.orgs o on o.id = pm.org_id join public.plans pl on pl.id = pm.plan_id
    where pm.status = 'paid' and pm.plan_id is not null and pm.paid_at is not null
    union all
    -- PermitPal Plus and staff licences
    select private.ph_day(i.paid_at), 'plans', case i.kind when 'plus' then 'plus' else 'staff_licences' end, 'collected', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, i.bir_invoice_no, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status = 'paid' and i.amount_php > 0 and i.paid_at is not null
    union all
    select private.ph_day(i.created_at), 'plans', case i.kind when 'plus' then 'plus' else 'staff_licences' end, 'to_collect', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, null, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status in ('due','pending_verification') and i.amount_php > 0
  )
  select l.day, l.stream, l.kind, l.state, l.amount, l.label, l.who, l.ref_kind, l.ref_id, l.invoice_no, l.rush from lines l
  where l.day between p_from and p_to or l.state in ('to_collect','pipeline','unbilled','to_pay')
  order by l.day desc, l.stream;
end $function$;

-- Money summary: Plus and staff licence payments to confirm, monthly income from them, invoices to issue.
CREATE OR REPLACE FUNCTION public.admin_money_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'addon_payments_to_check', (select count(*) from public.addon_invoices where status = 'pending_verification'),
    'mrr_addons', coalesce((select sum(case a.billing when 'yearly' then round(private.addon_price(a.kind, a.people_max, 'yearly') / 12, 2)
                                    else private.addon_price(a.kind, a.people_max, 'monthly') end)
                           from public.addons a where not a.trial and not a.comped and a.paid_through >= v_today), 0),
    'plus_paying', (select count(*) from public.addons where kind = 'plus' and not trial and not comped and paid_through >= v_today),
    'plus_trials', (select count(*) from public.addons where kind = 'plus' and trial and paid_through >= v_today),
    'staff_paying', (select count(*) from public.addons where kind = 'staff' and not comped and paid_through >= v_today),
    'care_overdue', (select count(*) from public.care_invoices where status = 'due' and due_on < v_today),
    'claims_to_decide', (select count(*) from public.guarantee_claims where status = 'submitted'),
    'claims_to_pay', (select count(*) from public.guarantee_claims where status = 'approved'),
    'partners_to_bill', (select count(distinct partner_id) from public.partner_charges where status = 'unbilled' and occurred_on < date_trunc('month', v_today)::date),
    'statements_overdue', (select count(*) from public.partner_statements where status = 'sent' and due_on < v_today),
    'applications_new', (select count(*) from public.partner_applications where status = 'new'),
    'disputes_open', (select count(*) from public.lead_disputes where status = 'open'),
    'firms_paused', (select count(*) from public.partners p where p.published and not private.partner_live(p)),
    'credit_held', coalesce((select sum(credit_php) from public.partners), 0),
    'staff_access_open', (select count(*) from private.staff_memberships where ended_at is null),
    'covered_missing_dates', (select count(distinct c.requirement_id) from public.care_plans p cross join lateral private.care_covered(p.id) c
                              join public.requirement_status rs on rs.id = c.requirement_id
                              where p.status = 'active' and rs.expires and rs.expires_on is null),
    'missing_invoice', (select count(*) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and coalesce(quote_php, 0) > 0 and bir_invoice_no is null)
                     + (select count(*) from public.care_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
                     + (select count(*) from public.partner_statements where status = 'paid' and bir_invoice_no is null)
                     + (select count(*) from public.payments where status = 'paid' and plan_id is not null and bir_invoice_no is null)
                     + (select count(*) from public.partner_credits where kind = 'topup' and bir_invoice_no is null)
                     + (select count(*) from public.addon_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
  ) into v;
  return v;
end $function$;

-- BIR invoice numbers for those bills too.
CREATE OR REPLACE FUNCTION public.admin_set_invoice_no(p_kind text, p_id uuid, p_no text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_no text := nullif(btrim(coalesce(p_no, '')), '');
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if length(coalesce(v_no, '')) > 60 then raise exception 'That invoice number is too long.' using errcode = '22023'; end if;
  if p_kind = 'order' then update public.assistance_requests set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'care' then update public.care_invoices set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'statement' then update public.partner_statements set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'plan' then update public.payments set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'addon' then update public.addon_invoices set bir_invoice_no = v_no where id = p_id and status = 'paid';
  elsif p_kind = 'credit' then update public.partner_credits set bir_invoice_no = v_no where id = p_id and kind = 'topup';
  else raise exception 'Unknown payment.' using errcode = '22023'; end if;
  if not found then raise exception 'Payment not found.' using errcode = 'P0002'; end if;
end $function$;

-- Staff can open the payment screenshot sent with a bill (logged like every file staff open).
CREATE OR REPLACE FUNCTION public.staff_open_file(p_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid; v_parts text[]; v_name text; v_reason text; v_staff text;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  v_parts := string_to_array(p_path, '/');
  begin v_org := v_parts[1]::uuid; exception when others then raise exception 'Bad file path.' using errcode = '22023'; end;
  if v_parts[2] = 'requests' then
    select a.requirement_name || ' — ' || a.subject_label into v_reason
      from public.assistance_requests a where a.org_id = v_org and a.id::text = v_parts[3];
    if v_reason is null then raise exception 'This file is not part of a request.' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  elsif v_parts[2] = 'billing' then
    select 'Payment proof, bill ' || i.number into v_reason from public.addon_invoices i where i.org_id = v_org and i.id::text = v_parts[3] and i.proof_path = p_path;
    if v_reason is null then raise exception 'This file is not part of a bill.' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  elsif v_parts[2] = 'care' then
    select coalesce((select 'Care bill ' || i.number from public.care_invoices i where i.org_id = v_org and i.id::text = v_parts[3] and i.proof_path = p_path),
                    (select 'Guarantee claim: ' || g.requirement_name from public.guarantee_claims g where g.org_id = v_org and g.id::text = v_parts[3] and g.receipt_path = p_path),
                    (select 'Guarantee claim: ' || g.requirement_name from public.guarantee_claims g where g.org_id = v_org and g.receipt_path = p_path))
      into v_reason;
    if v_reason is null then raise exception 'This file is not part of a care bill or claim.' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  else
    select d.file_name, a.requirement_name || ' — ' || a.subject_label into v_name, v_reason
      from public.documents d
      join public.assistance_requests a on a.requirement_id = d.requirement_id and a.status not in ('completed','cancelled')
      where d.storage_path = p_path and d.org_id = v_org and d.deleted_at is null
      limit 1;
    if v_name is null then raise exception 'You can only open a customer''s files while they have an open request for that permit.' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.org_members m where m.org_id = v_org and m.user_id = auth.uid()) then
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), 'PermitPal staff') into v_staff from public.profiles p where p.id = auth.uid();
    insert into public.staff_file_access (org_id, staff_id, staff_name, file_path, file_name, reason)
    values (v_org, auth.uid(), coalesce(v_staff, 'PermitPal staff'), p_path, regexp_replace(v_name, '^[a-z0-9]{6,}-', ''),
      case when v_parts[2] in ('care','billing') then v_reason else 'Request: ' || v_reason end);
  end if;
  return v_name;
end $function$;

-- The morning job does the Plus and staff work too.
CREATE OR REPLACE FUNCTION private.revenue_daily()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int := 0;
begin
  v_n := v_n + private.care_daily();
  v_n := v_n + private.partner_monthly_charges();
  v_n := v_n + private.referral_followups();
  v_n := v_n + private.plus_daily();
  delete from private.placement_seen where day < private.today_ph() - 60;
  return v_n;
end $function$;

-- ---------------------------------------------------------------- who may call what
do $$ declare f text; begin
  foreach f in array array[
    'public.addon_preview(uuid,text,int,text)', 'public.addon_checkout(uuid,text,int,text)', 'public.addon_report_payment(uuid,text,text,text,text)',
    'public.addon_cancel_invoice(uuid)', 'public.addon_stop(uuid,text)', 'public.addon_resume(uuid,text)', 'public.addon_stopping(uuid)',
    'public.start_plus_trial(uuid)', 'public.admin_confirm_addon_payment(uuid,boolean,text,text)', 'public.admin_void_addon_invoice(uuid,text)',
    'public.admin_set_addon(uuid,text,int,date,text)',
    'public.worker_link(uuid)', 'public.worker_decide(uuid,boolean,date,date,text,text)',
    'public.save_staff_role(uuid,text,text[])', 'public.delete_staff_role(uuid)', 'public.apply_staff_role(uuid)',
    'public.trust_page_save(uuid,uuid,text,text,boolean,boolean,boolean,text,uuid[],boolean)', 'public.trust_page_new_code(uuid)', 'public.trust_page_delete(uuid)',
    'public.trust_add_recipient(uuid,text,text,text)', 'public.trust_remove_recipient(uuid)', 'public.trust_decide_request(uuid,boolean)',
    'public.run_permit_check(uuid)', 'public.dismiss_finding(uuid,text)', 'public.reopen_finding(uuid)', 'public.save_document_reading(uuid,jsonb)',
    'public.list_templates()', 'public.get_template(uuid,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- no account needed: the worker's upload link, the public permit page, asking for updates, unsubscribing
  foreach f in array array['public.worker_page(uuid)', 'public.worker_submit(uuid,text,text,text,bigint,date,date,text,text)',
    'public.get_trust_page(text,text,uuid)', 'public.trust_badge(text)', 'public.trust_request_updates(text,text,text,text,text)', 'public.trust_unsubscribe(uuid)',
    'public.pp_worker_may_upload(text)', 'public.pp_worker_folder_open(text)', 'public.pp_public_copy(text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  -- internal helpers: never called from the app
  foreach f in array array['private.addon_paid(uuid,text,text,date)', 'private.addon_quote(uuid,text,int,text)', 'private.addon_payment_start(uuid,text)',
    'private.sync_people(uuid)', 'private.run_audit(uuid,text)', 'private.audit_report(uuid,boolean)', 'private.audit_scan(uuid)', 'private.plus_daily()',
    'private.worker_reminders()', 'private.trust_updates()', 'private.trust_welcome(uuid)', 'private.worker_link_for(uuid)', 'private.trust_items(uuid)',
    'private.trust_file_ok(text)', 'private.worker_upload_ok(text)', 'private.worker_folder_open(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Workspaces that already track more than 3 people keep them all, free for 30 days, with a heads-up.
do $$ declare o record; v_until date := private.today_ph() + 29; begin
  for o in select p.org_id, count(*) as n from public.people p join public.orgs og on og.id = p.org_id and og.deleted_at is null
      where p.deleted_at is null group by p.org_id having count(*) > private.free_people() loop
    insert into public.addons (org_id, kind, people_max, billing, paid_through, comped, started_on)
    values (o.org_id, 'staff', greatest(o.n, 4), 'monthly', v_until, true, private.today_ph()) on conflict (org_id, kind) do nothing;
    perform private.notify_owners(o.org_id, 'Staff licences: your ' || o.n || ' people are covered free until ' || private.fmt_date(v_until),
      'The first ' || private.free_people() || ' people are always free; more are ₱100 a month each (less from the 21st person). Choose under Settings > Plan before then to keep reminders going for everyone.',
      '#/settings/billing', 'staffgrace:' || o.org_id, true, true);
  end loop;
end $$;

insert into private.features (name) values ('plus') on conflict do nothing;
