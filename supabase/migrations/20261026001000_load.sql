-- PermitPal load: a prepaid balance per workspace, topped up by GCash, Maya, bank transfer or online
-- checkout, and spent on small things that each do one useful job.
-- 1) Text reminders for workspaces whose plan doesn't include texts: packs of 50 and 200. One text uses
--    one credit, credits never expire, and a text that can't be delivered gives its credit back.
--    Tax and contribution deadlines are now texted too (to everyone whose plan or credits cover texts).
-- 2) One template, yours to keep: the full text of a single template without PermitPal Plus.
-- 3) Papers check: PermitPal staff go through a permit's checklist against photos of the customer's papers
--    before they queue, and answer by 6 pm the next business day, or the load comes back by itself.
-- 4) Renewal season pass (on sale September to January, good until the end of February): up to 100 texts,
--    one papers check, and a renewal plan by email when bought, on December 1 and on January 5.
-- 5) Invite a business: once the business you invited adds 3 permits with their dates, you both get a
--    month of PermitPal Plus (or the same value as bonus load if you already have Plus).
-- Paid load can be refunded to the customer on request; bonus load (from invites or staff) can't. Load
-- only pays for PermitPal's own services in the same workspace and can't be sent to anyone.

-- ================================================================ tables
-- The balance of each workspace: paid load (refundable), bonus load (not refundable) and text credits.
create table if not exists public.load_wallets (
  org_id     uuid primary key references public.orgs(id) on delete cascade,
  paid_php   numeric(12,2) not null default 0 check (paid_php >= 0),
  bonus_php  numeric(12,2) not null default 0 check (bonus_php >= 0),
  texts      int not null default 0 check (texts >= 0),
  updated_at timestamptz not null default now()
);
-- Every change to a balance, newest first in the app. Amounts are the change (+ in, - out).
create table if not exists public.load_entries (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  kind       text not null check (kind in ('topup','spend','refund','bonus','cashout')),
  paid_php   numeric(12,2) not null default 0,
  bonus_php  numeric(12,2) not null default 0,
  texts      int not null default 0,
  item       text check (item is null or length(item) <= 80),
  label      text not null check (length(label) <= 200),
  ref_id     uuid,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists load_entries_org on public.load_entries(org_id, created_at desc);
create index if not exists load_entries_ref on public.load_entries(ref_id) where ref_id is not null;

-- A top-up bill: pay it, report the reference (or pay online), and the load is added.
create table if not exists public.load_topups (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  org_id         uuid not null references public.orgs(id) on delete cascade,
  amount_php     numeric(12,2) not null check (amount_php between 100 and 5000 and amount_php % 50 = 0),
  status         text not null default 'due' check (status in ('due','pending_verification','paid','cancelled')),
  valid_until    date not null,
  pay_method     text check (pay_method is null or pay_method in ('gcash','maya','bank_transfer','other','online')),
  pay_ref        text check (pay_ref is null or length(pay_ref) <= 120),
  proof_path     text check (proof_path is null or length(proof_path) <= 400),
  proof_name     text check (proof_name is null or length(proof_name) <= 255),
  reported_at    timestamptz,
  paid_at        timestamptz,
  bir_invoice_no text check (bir_invoice_no is null or length(bir_invoice_no) <= 60),
  note           text check (note is null or length(note) <= 500),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists load_topups_org on public.load_topups(org_id, created_at desc);
alter table public.payments add column if not exists load_topup_id uuid references public.load_topups(id) on delete set null;

-- What load buys, and its price. Staff can change prices or switch a product off in Admin > Load.
create table if not exists public.load_products (
  code       text primary key check (code in ('texts_50','texts_200','template','papers_check','season_pass')),
  name       text not null check (length(name) <= 80),
  price_php  numeric(10,2) not null check (price_php >= 0 and price_php <= 5000),
  texts      int not null default 0 check (texts >= 0),
  active     boolean not null default true,
  sort       int not null default 100,
  updated_at timestamptz not null default now()
);
insert into public.load_products (code, name, price_php, texts, sort) values
  ('texts_50', '50 text reminders', 49, 50, 10),
  ('texts_200', '200 text reminders', 179, 200, 20),
  ('template', 'One template, yours to keep', 39, 0, 30),
  ('papers_check', 'Papers check', 149, 0, 40),
  ('season_pass', 'Renewal season pass', 149, 0, 50)
on conflict (code) do nothing;

-- Templates a workspace bought one by one (Plus has them all).
create table if not exists public.template_unlocks (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  code        text not null references public.doc_templates(code) on delete cascade,
  price_php   numeric(10,2) not null default 0,
  unlocked_by uuid default auth.uid() references auth.users(id) on delete set null,
  unlocked_at timestamptz not null default now(),
  primary key (org_id, code)
);

-- A papers check: the customer's photos of the papers for one permit, checked by PermitPal staff against
-- the permit's checklist before the customer files. Names are kept as they were when asked.
create table if not exists public.papers_checks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  requirement_id   uuid not null references public.requirements(id) on delete cascade,
  cycle_id         uuid,
  requirement_name text not null,
  subject_label    text not null,
  city             text,
  status           text not null default 'waiting' check (status in ('waiting','answered','refunded','cancelled')),
  note             text check (note is null or length(note) <= 1000),
  paid_with        text not null check (paid_with in ('load','pass')),
  price_php        numeric(10,2) not null default 0,
  due_by           timestamptz not null,
  verdict          text check (verdict is null or verdict in ('ready','almost','not_ready')),
  items            jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  summary          text check (summary is null or length(summary) <= 2000),
  answered_at      timestamptz,
  answered_by      uuid references auth.users(id) on delete set null,
  refunded_at      timestamptz,
  refund_reason    text check (refund_reason is null or length(refund_reason) <= 300),
  requested_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  check ((status = 'answered') = (answered_at is not null))
);
create index if not exists papers_checks_org on public.papers_checks(org_id, created_at desc);
create unique index if not exists papers_checks_one_open on public.papers_checks(requirement_id) where status = 'waiting';
create table if not exists public.papers_check_files (
  id           bigint generated always as identity primary key,
  check_id     uuid not null references public.papers_checks(id) on delete cascade,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  storage_path text not null unique check (length(storage_path) <= 400),
  file_name    text not null check (length(file_name) <= 255),
  mime_type    text check (mime_type is null or length(mime_type) <= 100),
  created_at   timestamptz not null default now()
);

-- The renewal season pass: one per workspace per season (the January the renewals are due).
create table if not exists public.season_passes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  season     int not null check (season between 2020 and 2100),
  starts_on  date not null,
  ends_on    date not null,
  texts_cap  int not null default 100 check (texts_cap between 0 and 1000),
  check_id   uuid references public.papers_checks(id) on delete set null,
  price_php  numeric(10,2) not null default 0,
  bought_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, season),
  check (ends_on >= starts_on)
);

-- Inviting other businesses: one code per workspace, and the businesses that joined with it.
create table if not exists public.invite_codes (
  org_id     uuid primary key references public.orgs(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.invite_signups (
  id             uuid primary key default gen_random_uuid(),
  inviter_org    uuid not null references public.orgs(id) on delete cascade,
  invited_org    uuid not null unique references public.orgs(id) on delete cascade,
  invited_user   uuid references auth.users(id) on delete set null,
  status         text not null default 'pending' check (status in ('pending','rewarded','void')),
  inviter_reward text check (inviter_reward is null or inviter_reward in ('plus_month','bonus_load','capped')),
  invited_reward text check (invited_reward is null or invited_reward in ('plus_month','bonus_load')),
  reason         text check (reason is null or length(reason) <= 300),
  created_at     timestamptz not null default now(),
  rewarded_at    timestamptz,
  check (inviter_org <> invited_org)
);
create index if not exists invite_signups_inviter on public.invite_signups(inviter_org, created_at desc);

-- Which texts used what: the workspace's plan, its season pass, or one of its text credits.
alter table public.message_outbox add column if not exists text_source text check (text_source is null or text_source in ('plan','season','credit'));

-- ---------------------------------------------------------------- who can see what
alter table public.load_wallets enable row level security;
alter table public.load_entries enable row level security;
alter table public.load_topups enable row level security;
alter table public.load_products enable row level security;
alter table public.template_unlocks enable row level security;
alter table public.papers_checks enable row level security;
alter table public.papers_check_files enable row level security;
alter table public.season_passes enable row level security;
alter table public.invite_codes enable row level security;
alter table public.invite_signups enable row level security;
drop policy if exists load_wallets_read on public.load_wallets;
create policy load_wallets_read on public.load_wallets for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
drop policy if exists load_entries_read on public.load_entries;
create policy load_entries_read on public.load_entries for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
drop policy if exists load_topups_read on public.load_topups;
create policy load_topups_read on public.load_topups for select to authenticated
  using (org_id in (select private.my_admin_org_ids()) or (select private.is_platform_admin()));
drop policy if exists load_products_read on public.load_products;
create policy load_products_read on public.load_products for select to anon, authenticated using (true);
drop policy if exists template_unlocks_read on public.template_unlocks;
create policy template_unlocks_read on public.template_unlocks for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
drop policy if exists papers_checks_read on public.papers_checks;
create policy papers_checks_read on public.papers_checks for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
drop policy if exists papers_check_files_read on public.papers_check_files;
create policy papers_check_files_read on public.papers_check_files for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
drop policy if exists season_passes_read on public.season_passes;
create policy season_passes_read on public.season_passes for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
drop policy if exists invite_codes_read on public.invite_codes;
create policy invite_codes_read on public.invite_codes for select to authenticated
  using (org_id in (select private.my_admin_org_ids()) or (select private.is_platform_admin()));
drop policy if exists invite_signups_read on public.invite_signups;
create policy invite_signups_read on public.invite_signups for select to authenticated
  using (inviter_org in (select private.my_admin_org_ids()) or invited_org in (select private.my_admin_org_ids()) or (select private.is_platform_admin()));
-- Everything is changed through the functions below, never directly.
revoke insert, update, delete on public.load_wallets, public.load_entries, public.load_topups, public.load_products, public.template_unlocks,
  public.papers_checks, public.papers_check_files, public.season_passes, public.invite_codes, public.invite_signups from anon, authenticated;
revoke all on public.load_wallets, public.load_entries, public.load_topups, public.template_unlocks, public.papers_checks,
  public.papers_check_files, public.season_passes, public.invite_codes, public.invite_signups from anon;
grant select on public.load_wallets, public.load_entries, public.load_topups, public.load_products, public.template_unlocks,
  public.papers_checks, public.papers_check_files, public.season_passes, public.invite_codes, public.invite_signups to authenticated;
grant select on public.load_products to anon;

-- ================================================================ helpers
create or replace function private.load_price(p_code text) returns numeric
language sql stable security definer set search_path = '' as $$ select price_php from public.load_products where code = p_code $$;
create or replace function private.load_on_sale(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce((select active from public.load_products where code = p_code), false) $$;
-- The January a season pass is for: September to December sell next January's, January sells this one's.
create or replace function private.season_for(p_day date) returns int
language sql immutable set search_path = '' as $$
  select case when extract(month from p_day) >= 9 then extract(year from p_day)::int + 1
              when extract(month from p_day) = 1 then extract(year from p_day)::int end
$$;
-- 6 pm Manila time on the next weekday.
create or replace function private.next_business_6pm(p_ts timestamptz) returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare d date := (p_ts at time zone 'Asia/Manila')::date + 1;
begin
  while extract(isodow from d) in (6, 7) loop d := d + 1; end loop;
  return (d + time '18:00') at time zone 'Asia/Manila';
end $$;
create or replace function private.load_ready() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.features where name = 'load') then raise exception 'PermitPal load is not switched on yet.' using errcode = 'P0001'; end if;
end $$;
create or replace function private.need_org_admin(p_org uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org is null or not private.is_org_admin(p_org) or not exists (select 1 from public.orgs where id = p_org and deleted_at is null) then
    raise exception 'Only the workspace owner or an admin can use the load.' using errcode = '42501';
  end if;
end $$;

-- Money in: paid (refundable) or bonus (not refundable), and text credits.
create or replace function private.load_add(p_org uuid, p_kind text, p_paid numeric, p_bonus numeric, p_texts int, p_item text, p_label text, p_ref uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.load_wallets (org_id) values (p_org) on conflict (org_id) do nothing;
  update public.load_wallets set paid_php = paid_php + coalesce(p_paid, 0), bonus_php = bonus_php + coalesce(p_bonus, 0),
    texts = texts + coalesce(p_texts, 0), updated_at = now() where org_id = p_org;
  insert into public.load_entries (org_id, kind, paid_php, bonus_php, texts, item, label, ref_id)
  values (p_org, p_kind, coalesce(p_paid, 0), coalesce(p_bonus, 0), coalesce(p_texts, 0), p_item, left(p_label, 200), p_ref);
end $$;

-- Money out for something bought: bonus load is used first, then paid load.
create or replace function private.load_spend(p_org uuid, p_amount numeric, p_item text, p_label text, p_ref uuid, p_texts int default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare w public.load_wallets; v_bonus numeric; v_paid numeric;
begin
  if coalesce(p_amount, -1) < 0 then raise exception 'Bad amount.' using errcode = '22023'; end if;
  insert into public.load_wallets (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into w from public.load_wallets where org_id = p_org for update;
  if w.paid_php + w.bonus_php < p_amount then
    raise exception 'Not enough load: this is %, and you have %. Top up first.', private.peso(p_amount), private.peso(w.paid_php + w.bonus_php)
      using errcode = 'P0001', hint = 'load';
  end if;
  v_bonus := least(w.bonus_php, p_amount); v_paid := p_amount - v_bonus;
  update public.load_wallets set bonus_php = bonus_php - v_bonus, paid_php = paid_php - v_paid, texts = texts + coalesce(p_texts, 0), updated_at = now()
  where org_id = p_org;
  insert into public.load_entries (org_id, kind, paid_php, bonus_php, texts, item, label, ref_id)
  values (p_org, 'spend', -v_paid, -v_bonus, coalesce(p_texts, 0), p_item, left(p_label, 200), p_ref);
end $$;

-- Give back what was spent on something (it goes back the way it came: paid or bonus).
create or replace function private.load_give_back(p_org uuid, p_ref uuid, p_label text) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_paid numeric; v_bonus numeric;
begin
  select -coalesce(sum(paid_php), 0), -coalesce(sum(bonus_php), 0) into v_paid, v_bonus
  from public.load_entries where org_id = p_org and ref_id = p_ref and kind in ('spend','refund');
  if v_paid <= 0 and v_bonus <= 0 then return 0; end if;
  perform private.load_add(p_org, 'refund', v_paid, v_bonus, 0, null, p_label, p_ref);
  return v_paid + v_bonus;
end $$;

-- ================================================================ topping up
create or replace function public.load_topup_start(p_org uuid, p_amount numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.load_ready();
  perform private.need_org_admin(p_org);
  if p_amount is null or p_amount < 100 or p_amount > 5000 or p_amount % 50 <> 0 then
    raise exception 'Choose an amount from ₱100 to ₱5,000, in steps of ₱50.' using errcode = '22023';
  end if;
  -- one open bill at a time: an older one nobody paid is replaced
  update public.load_topups set status = 'cancelled', note = 'Replaced by a new top-up.' where org_id = p_org and status = 'due';
  insert into public.load_topups (number, org_id, amount_php, valid_until)
  values (private.next_no('L'), p_org, p_amount, private.today_ph() + 7) returning id into v_id;
  return v_id;
end $$;

create or replace function public.load_topup_report(p_topup uuid, p_method text, p_ref text, p_proof_path text default null, p_proof_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.load_topups;
begin
  select * into t from public.load_topups where id = p_topup for update;
  if t.id is null or not private.is_org_admin(t.org_id) then raise exception 'Top-up not found.' using errcode = '42501'; end if;
  if t.status not in ('due','pending_verification') then raise exception 'This top-up is already paid or was replaced.' using errcode = 'P0001'; end if;
  if t.valid_until < private.today_ph() then raise exception 'This top-up has expired. Start a new one.' using errcode = 'P0001'; end if;
  if coalesce(p_method, '') not in ('gcash','maya','bank_transfer','other') then raise exception 'Choose how you paid.' using errcode = '22023'; end if;
  if coalesce(btrim(p_ref), '') = '' and p_proof_path is null then raise exception 'Add the reference number or a screenshot of the payment.' using errcode = '22023'; end if;
  if length(coalesce(p_ref, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  if p_proof_path is not null and p_proof_path not like t.org_id::text || '/load/' || t.id::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '42501';
  end if;
  update public.load_topups set status = 'pending_verification', pay_method = p_method, pay_ref = nullif(btrim(p_ref), ''),
    proof_path = coalesce(p_proof_path, proof_path), proof_name = coalesce(left(p_proof_name, 255), proof_name), reported_at = now(), note = null
  where id = t.id;
  perform private.notify_admins('Load top-up to confirm: ' || t.number,
    (select name from public.orgs where id = t.org_id) || ' - ' || private.peso(t.amount_php) || ' via ' || replace(p_method, '_', ' ')
      || coalesce(', ref ' || nullif(btrim(p_ref), ''), ''),
    'loadpay:' || t.id || ':' || extract(epoch from now())::bigint, true);
end $$;

create or replace function public.load_topup_cancel(p_topup uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.load_topups;
begin
  select * into t from public.load_topups where id = p_topup for update;
  if t.id is null or not private.is_org_admin(t.org_id) then raise exception 'Top-up not found.' using errcode = '42501'; end if;
  if t.status <> 'due' then raise exception 'Only a top-up you haven''t paid yet can be cancelled.' using errcode = 'P0001'; end if;
  update public.load_topups set status = 'cancelled', note = 'Cancelled.' where id = t.id;
end $$;

-- The money arrived (staff confirmed it, or the online checkout said so): add the load.
create or replace function private.load_topup_paid(p_topup uuid, p_method text, p_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.load_topups; v_total numeric;
begin
  select * into t from public.load_topups where id = p_topup for update;
  if t.id is null or t.status = 'paid' then return; end if;
  update public.load_topups set status = 'paid', paid_at = now(), pay_method = coalesce(p_method, pay_method),
    pay_ref = coalesce(nullif(btrim(p_ref), ''), pay_ref), note = null where id = t.id;
  perform private.load_add(t.org_id, 'topup', t.amount_php, 0, 0, null,
    'Top-up ' || t.number || coalesce(' (' || replace(coalesce(p_method, t.pay_method), '_', ' ') || ')', ''), t.id);
  select paid_php + bonus_php into v_total from public.load_wallets where org_id = t.org_id;
  perform private.notify_owners(t.org_id, private.peso(t.amount_php) || ' load added: thank you',
    'Top-up ' || t.number || ' is in. Your load is now ' || private.peso(v_total) || '.', '#/load', 'loadpaid:' || t.id, true, true);
end $$;

create or replace function public.admin_confirm_topup(p_topup uuid, p_ok boolean, p_note text default null, p_invoice_no text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.load_topups;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into t from public.load_topups where id = p_topup for update;
  if t.id is null then raise exception 'Top-up not found.' using errcode = 'P0002'; end if;
  if not coalesce(p_ok, false) then
    if t.status <> 'pending_verification' then raise exception 'Nothing to check on this top-up.' using errcode = 'P0001'; end if;
    update public.load_topups set status = 'due', valid_until = greatest(valid_until, private.today_ph() + 3),
      note = coalesce(nullif(btrim(p_note), ''), 'We could not find this payment. Please check the reference number and send it again.') where id = t.id;
    perform private.notify_owners(t.org_id, 'We couldn''t match your payment for top-up ' || t.number,
      coalesce(nullif(btrim(p_note), ''), 'Please check the reference number and send it again.'), '#/load',
      'loadnomatch:' || t.id || ':' || extract(epoch from now())::bigint, true, true);
    return;
  end if;
  if t.status = 'paid' then raise exception 'This top-up is already paid.' using errcode = 'P0001'; end if;
  if nullif(btrim(p_invoice_no), '') is not null then
    if length(btrim(p_invoice_no)) > 60 then raise exception 'That invoice number is too long.' using errcode = '22023'; end if;
    update public.load_topups set bir_invoice_no = btrim(p_invoice_no) where id = t.id;
  end if;
  perform private.load_topup_paid(t.id, null, null);
end $$;

-- Online checkout: the app asks for plan "load:<top-up id>"; billing_start hands it the amount.
create or replace function private.load_payment_start(p_org uuid, p_plan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.load_topups; v_id uuid;
begin
  if p_plan !~ '^load:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Unknown top-up.' using errcode = '22023'; end if;
  select * into t from public.load_topups where id = substr(p_plan, 6)::uuid;
  if t.id is null or t.org_id is distinct from p_org or not private.is_org_admin(p_org) then raise exception 'Top-up not found.' using errcode = '42501'; end if;
  if t.status <> 'due' then raise exception 'This top-up is already paid or was replaced.' using errcode = 'P0001'; end if;
  if t.valid_until < private.today_ph() then raise exception 'This top-up has expired. Start a new one.' using errcode = 'P0001'; end if;
  insert into public.payments (org_id, plan_id, months, amount_php, created_by, load_topup_id)
  values (p_org, null, 1, t.amount_php, auth.uid(), t.id) returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'amount_php', t.amount_php, 'kind', 'load',
    'plan_name', 'load top-up ' || t.number, 'months', 1,
    'org_name', (select name from public.orgs where id = p_org), 'email', (select email from public.profiles where id = auth.uid()));
end $$;

-- ================================================================ text reminders
-- Where a text for this workspace comes from today: its plan, its season pass, or its text credits.
create or replace function private.text_source(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when coalesce((select pl.paid_channels from public.plans pl where pl.id = private.effective_plan_id(p_org)), false) then 'plan'
    when exists (select 1 from public.season_passes s where s.org_id = p_org and private.today_ph() between s.starts_on and s.ends_on
                   and (select count(*) from public.message_outbox m where m.org_id = p_org and m.channel = 'sms' and m.text_source = 'season'
                          and m.status not in ('skipped','failed') and m.created_at >= (s.starts_on::timestamp at time zone 'Asia/Manila')) < s.texts_cap) then 'season'
    when coalesce((select w.texts from public.load_wallets w where w.org_id = p_org), 0) > 0 then 'credit'
  end
$$;

create or replace function public.buy_texts(p_org uuid, p_pack text) returns int
language plpgsql security definer set search_path = '' as $$
declare p public.load_products; v_texts int;
begin
  perform private.load_ready();
  perform private.need_org_admin(p_org);
  select * into p from public.load_products where code = p_pack and code in ('texts_50','texts_200');
  if p.code is null or not p.active then raise exception 'That text pack isn''t available.' using errcode = 'P0001'; end if;
  if coalesce((nullif(private.setting('channel_status'), '')::jsonb ->> 'sms'), 'false') <> 'true' then
    raise exception 'Text reminders aren''t available yet. Nothing was charged.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.org_members m join public.profiles pr on pr.id = m.user_id
                 where m.org_id = p_org and m.role <> 'viewer' and pr.phone is not null and pr.phone_verified_at is not null) then
    raise exception 'Add and verify a mobile number first (Settings > Notifications), so the texts have somewhere to go.' using errcode = 'P0001', hint = 'phone';
  end if;
  perform private.load_spend(p_org, p.price_php, p.code, p.name, null, p.texts);
  select texts into v_texts from public.load_wallets where org_id = p_org;
  return v_texts;
end $$;

-- Every text is checked on its way out (see sms_verified); now it also says what pays for it and uses one
-- credit when the workspace's plan doesn't include texts. The monthly cap only covers texts PermitPal pays for.
create or replace function private.outbox_sms_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cap int; v_src text; v_left int;
begin
  if new.channel <> 'sms' or new.status <> 'queued' then return new; end if;
  if new.dedupe_key like 'verify:%' then return new; end if;  -- the code itself goes to the number being verified
  if new.user_id is null or not exists (select 1 from public.profiles p where p.id = new.user_id and p.phone = new.to_address and p.phone_verified_at is not null) then
    new.status := 'skipped'; new.last_error := 'Mobile number not verified'; return new;
  end if;
  if (select count(*) from public.message_outbox m where m.channel = 'sms' and m.user_id = new.user_id and m.status <> 'skipped'
        and m.created_at > now() - interval '1 day' and m.dedupe_key not like 'verify:%') >= 3 then
    new.status := 'skipped'; new.last_error := 'Daily text limit reached (3 a day)'; return new;
  end if;
  v_src := case when new.org_id is null then 'plan' else private.text_source(new.org_id) end;
  if v_src is null then new.status := 'skipped'; new.last_error := 'No texts left for this workspace'; return new; end if;
  if v_src = 'plan' then
    v_cap := coalesce(nullif((select value from public.app_settings where key = 'sms_monthly_cap'), '')::int, 1000);
    if (select count(*) from public.message_outbox m where m.channel = 'sms' and m.status <> 'skipped' and coalesce(m.text_source, 'plan') = 'plan'
          and m.created_at >= date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila') >= v_cap then
      new.status := 'skipped'; new.last_error := 'Monthly text limit reached'; return new;
    end if;
  elsif v_src = 'credit' then
    update public.load_wallets set texts = texts - 1, updated_at = now() where org_id = new.org_id and texts > 0 returning texts into v_left;
    if v_left is null then new.status := 'skipped'; new.last_error := 'No texts left for this workspace'; return new; end if;
    if v_left in (5, 0) then
      perform private.notify_owners(new.org_id,
        case when v_left = 0 then 'Your text reminders have run out' else 'Only 5 text reminders left' end,
        case when v_left = 0 then 'Reminders still come by email and in the app. Get another text pack from your load to keep the texts coming.'
             else 'Get another text pack from your load so the texts don''t stop.' end,
        '#/load', 'textslow:' || new.org_id || ':' || v_left || ':' ||
          (select count(*) from public.load_entries e where e.org_id = new.org_id and e.texts > 0), true, true);
    end if;
  end if;
  new.text_source := v_src;
  new.body_text := left(new.body_text, 300);
  return new;
end $$;

-- A paid-for text that couldn't be delivered gives its credit back.
create or replace function private.outbox_text_back() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.channel = 'sms' and new.text_source = 'credit' and new.org_id is not null
     and new.status in ('failed','skipped') and old.status not in ('failed','skipped') then
    update public.load_wallets set texts = texts + 1, updated_at = now() where org_id = new.org_id;
  end if;
  return new;
end $$;
drop trigger if exists message_outbox_text_back on public.message_outbox;
create trigger message_outbox_text_back after update of status on public.message_outbox
  for each row execute function private.outbox_text_back();

-- ================================================================ one template, yours to keep
create or replace function public.unlock_template(p_org uuid, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.doc_templates; v_price numeric;
begin
  perform private.load_ready();
  perform private.need_org_admin(p_org);
  if private.has_plus(p_org) then raise exception 'Your workspace has PermitPal Plus, so every template is already yours.' using errcode = 'P0001'; end if;
  select * into t from public.doc_templates where code = p_code;
  if t.code is null then raise exception 'Template not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.template_unlocks where org_id = p_org and code = p_code) then return; end if;
  if not private.load_on_sale('template') then raise exception 'Templates can''t be bought one by one right now.' using errcode = 'P0001'; end if;
  v_price := private.load_price('template');
  perform private.load_spend(p_org, v_price, 'template:' || t.code, 'Template: ' || t.title, null, 0);
  insert into public.template_unlocks (org_id, code, price_php) values (p_org, t.code, v_price);
end $$;

-- ================================================================ papers check
create or replace function public.request_papers_check(p_org uuid, p_requirement uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.requirement_status; v_id uuid; v_pass public.season_passes; v_price numeric; v_label text; v_due timestamptz := private.next_business_6pm(now());
begin
  perform private.load_ready();
  perform private.need_org_admin(p_org);
  if length(coalesce(p_note, '')) > 1000 then raise exception 'Please keep the note under 1,000 characters.' using errcode = '22023'; end if;
  select * into r from public.requirement_status where id = p_requirement and org_id = p_org;
  if r.id is null or exists (select 1 from public.requirements q where q.id = p_requirement and q.deleted_at is not null) then
    raise exception 'Permit not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.papers_checks where requirement_id = p_requirement and status = 'waiting') then
    raise exception 'A papers check for this permit is already waiting for an answer.' using errcode = 'P0001';
  end if;
  v_label := coalesce(r.subject_name, '') || case when r.location_name is not null and not coalesce(r.location_is_main, true) then ' (' || r.location_name || ')' else '' end
    || case when coalesce(r.plate_no, '') <> '' then ' - ' || r.plate_no else '' end;
  -- a season pass with its check unused pays for it; otherwise it comes from the load
  select * into v_pass from public.season_passes s where s.org_id = p_org and private.today_ph() between s.starts_on and s.ends_on and s.check_id is null
    order by s.starts_on limit 1 for update;
  if v_pass.id is null and not private.load_on_sale('papers_check') then raise exception 'Papers checks aren''t available right now.' using errcode = 'P0001'; end if;
  v_price := case when v_pass.id is null then private.load_price('papers_check') else 0 end;
  insert into public.papers_checks (org_id, requirement_id, cycle_id, requirement_name, subject_label, city, note, paid_with, price_php, due_by)
  values (p_org, p_requirement, r.cycle_id, r.name, coalesce(nullif(btrim(v_label), ''), r.name), r.location_city, nullif(btrim(p_note), ''),
          case when v_pass.id is null then 'load' else 'pass' end, v_price, v_due)
  returning id into v_id;
  if v_pass.id is null then
    perform private.load_spend(p_org, v_price, 'papers_check', 'Papers check: ' || r.name || coalesce(' (' || nullif(btrim(v_label), '') || ')', ''), v_id, 0);
  else
    update public.season_passes set check_id = v_id where id = v_pass.id;
  end if;
  perform private.notify_admins('Papers check to answer: ' || r.name,
    (select name from public.orgs where id = p_org) || ' - ' || coalesce(nullif(btrim(v_label), ''), r.name) || '. Answer by ' ||
      to_char(v_due at time zone 'Asia/Manila', 'Dy Mon FMDD, FMHH12:MI am') || '.',
    'papers:' || v_id, true);
  return v_id;
end $$;

create or replace function public.add_papers_check_file(p_check uuid, p_path text, p_name text, p_mime text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.papers_checks;
begin
  select * into c from public.papers_checks where id = p_check;
  if c.id is null or c.org_id not in (select private.my_writable_org_ids()) then raise exception 'Papers check not found.' using errcode = '42501'; end if;
  if c.status <> 'waiting' then raise exception 'This papers check is already answered.' using errcode = 'P0001'; end if;
  if p_path is null or p_path not like c.org_id::text || '/papers/' || c.id::text || '/%' then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  if (select count(*) from public.papers_check_files where check_id = c.id) >= 15 then raise exception 'Up to 15 photos per papers check.' using errcode = 'P0001'; end if;
  insert into public.papers_check_files (check_id, org_id, storage_path, file_name, mime_type)
  values (c.id, c.org_id, p_path, left(coalesce(nullif(btrim(p_name), ''), 'photo'), 255), left(p_mime, 100))
  on conflict (storage_path) do nothing;
end $$;

-- Staff can see the permit (its record and the files on it) while a papers check for it is open, as for orders.
create or replace function private.admin_can_see_requirement(p_req uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() and (
    exists (select 1 from public.assistance_requests a where a.requirement_id = p_req and a.status not in ('completed','cancelled'))
    or exists (select 1 from public.papers_checks c where c.requirement_id = p_req
               and (c.status = 'waiting' or (c.status = 'answered' and c.answered_at > now() - interval '7 days'))))
$$;

-- Give a check back: the load (or the season pass's check) returns.
create or replace function private.papers_refund(p_check uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.papers_checks; v_back numeric;
begin
  select * into c from public.papers_checks where id = p_check for update;
  if c.id is null or c.status in ('refunded','cancelled') then return; end if;
  update public.papers_checks set status = p_status, refunded_at = now(), refund_reason = left(p_reason, 300),
    answered_at = null where id = c.id;
  if c.paid_with = 'pass' then
    update public.season_passes set check_id = null where check_id = c.id;
  else
    v_back := private.load_give_back(c.org_id, c.id, 'Papers check ' || case when p_status = 'cancelled' then 'cancelled' else 'refunded' end || ': ' || c.requirement_name);
  end if;
end $$;

create or replace function public.cancel_papers_check(p_check uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.papers_checks;
begin
  select * into c from public.papers_checks where id = p_check;
  if c.id is null or not private.is_org_admin(c.org_id) then raise exception 'Papers check not found.' using errcode = '42501'; end if;
  if c.status <> 'waiting' then raise exception 'Only a check that hasn''t been answered can be cancelled.' using errcode = 'P0001'; end if;
  perform private.papers_refund(c.id, 'cancelled', 'Cancelled before it was answered.');
end $$;

create or replace function public.admin_answer_papers_check(p_check uuid, p_verdict text, p_items jsonb, p_summary text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.papers_checks; v_items jsonb; v_bad int; v record;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into c from public.papers_checks where id = p_check for update;
  if c.id is null then raise exception 'Papers check not found.' using errcode = 'P0002'; end if;
  if c.status <> 'waiting' then raise exception 'This papers check isn''t waiting for an answer.' using errcode = 'P0001'; end if;
  if coalesce(p_verdict, '') not in ('ready','almost','not_ready') then raise exception 'Choose the overall answer.' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then raise exception 'Bad checklist.' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_items) e
  where jsonb_typeof(e) <> 'object' or coalesce(e ->> 'state', '') not in ('ok','missing','fix','na') or length(coalesce(e ->> 't', '')) not between 1 and 300
     or length(coalesce(e ->> 'note', '')) > 500;
  if v_bad > 0 then raise exception 'Every checklist line needs an answer (and notes under 500 characters).' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_summary, ''))) < 3 then raise exception 'Write a short summary for the customer.' using errcode = '22023'; end if;
  if length(p_summary) > 2000 then raise exception 'Please keep the summary under 2,000 characters.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', left(coalesce(e ->> 'k', ''), 40), 't', e ->> 't', 'state', e ->> 'state',
           'note', nullif(btrim(coalesce(e ->> 'note', '')), ''))), '[]'::jsonb) into v_items from jsonb_array_elements(p_items) e;
  update public.papers_checks set status = 'answered', verdict = p_verdict, items = v_items, summary = btrim(p_summary),
    answered_at = now(), answered_by = auth.uid() where id = c.id;
  for v in select distinct u from (select c.requested_by as u union all select m.user_id from public.org_members m where m.org_id = c.org_id and m.role in ('owner','admin')) x where u is not null loop
    perform private.notify(v.u, c.org_id, 'help', 'Papers check done: ' || c.requirement_name,
      case p_verdict when 'ready' then 'Good news: your papers look complete.' when 'almost' then 'Almost there: a few things to fix before you file.'
           else 'Not ready yet: some papers are missing.' end || ' Open the permit to see each item.',
      '#/requirement/' || c.requirement_id, null, 'papersdone:' || c.id || ':' || v.u, true);
  end loop;
end $$;

create or replace function public.admin_refund_papers_check(p_check uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.papers_checks;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why, for the customer.' using errcode = '22023'; end if;
  select * into c from public.papers_checks where id = p_check;
  if c.id is null then raise exception 'Papers check not found.' using errcode = 'P0002'; end if;
  if c.status not in ('waiting','answered') then raise exception 'This papers check was already given back.' using errcode = 'P0001'; end if;
  perform private.papers_refund(c.id, 'refunded', btrim(p_note));
  perform private.notify_owners(c.org_id, 'Papers check refunded: ' || c.requirement_name,
    btrim(p_note) || case when c.paid_with = 'pass' then ' Your season pass''s check is free to use again.' else ' The ' || private.peso(c.price_php) || ' is back in your load.' end,
    '#/requirement/' || c.requirement_id, 'papersback:' || c.id, true, true);
end $$;

-- ================================================================ renewal season pass
create or replace function public.buy_season_pass(p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_season int := private.season_for(private.today_ph()); v_id uuid; v_price numeric;
begin
  perform private.load_ready();
  perform private.need_org_admin(p_org);
  if v_season is null then raise exception 'The renewal season pass is on sale from September to January.' using errcode = 'P0001'; end if;
  if not private.load_on_sale('season_pass') then raise exception 'The renewal season pass isn''t available right now.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.season_passes where org_id = p_org and season = v_season) then
    raise exception 'This workspace already has the % season pass.', v_season using errcode = 'P0001';
  end if;
  v_price := private.load_price('season_pass');
  insert into public.season_passes (org_id, season, starts_on, ends_on, price_php)
  values (p_org, v_season, v_today, make_date(v_season, 3, 1) - 1, v_price) returning id into v_id;
  perform private.load_spend(p_org, v_price, 'season_pass', 'Renewal season pass ' || v_season, v_id, 0);
  perform private.season_plan(v_id, 'start');
  return v_id;
end $$;

-- The renewal plan: everything due before the pass ends (or already late), with what's needed, by email.
create or replace function private.season_plan(p_pass uuid, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare s public.season_passes; v_html text; v_text text; v_n int; v_late int; m record; v_title text;
begin
  select * into s from public.season_passes where id = p_pass;
  if s.id is null then return 0; end if;
  select count(*), count(*) filter (where rs.days_left < 0),
    string_agg('<li style="margin:6px 0"><b>' || private.html_escape(rs.name) || '</b> - ' || private.html_escape(coalesce(rs.subject_name, '')) ||
      '<br><span style="color:#4B5568;font-size:13px">' ||
      case when rs.expires_on is null then 'No date on file yet: add it so we can remind you'
           when rs.days_left < 0 then 'Late since ' || private.fmt_date(rs.expires_on)
           else 'Due ' || private.fmt_date(rs.expires_on) end || '</span></li>', '' order by rs.expires_on nulls last, rs.name),
    string_agg('- ' || rs.name || ' (' || coalesce(rs.subject_name, '') || '): ' ||
      case when rs.expires_on is null then 'no date on file' when rs.days_left < 0 then 'late since ' || private.fmt_date(rs.expires_on)
           else 'due ' || private.fmt_date(rs.expires_on) end, E'\n' order by rs.expires_on nulls last, rs.name)
  into v_n, v_late, v_html, v_text
  from public.requirement_status rs
  where rs.org_id = s.org_id and rs.expires and (rs.expires_on is null or rs.expires_on <= s.ends_on)
    and not exists (select 1 from public.people pp where pp.id = rs.person_id and pp.paused_at is not null);
  v_title := case p_reason when 'start' then 'Your renewal season plan' when 'dec' then 'Renewal season starts now'
                           else '10 working days to January 20' end;
  for m in select user_id from public.org_members where org_id = s.org_id and role in ('owner','admin') loop
    perform private.queue_email(m.user_id, s.org_id, 'PermitPal: ' || v_title || ' (' || (select name from public.orgs where id = s.org_id) || ')', v_title,
      case when coalesce(v_n, 0) = 0 then '<p style="margin:0 0 8px">Nothing on your list is due before ' || private.fmt_date(s.ends_on) || '. We''ll tell you if that changes.</p>'
           else '<p style="margin:0 0 8px">' || v_n || ' thing' || case when v_n > 1 then 's' else '' end || ' to renew before ' || private.fmt_date(s.ends_on) ||
                case when v_late > 0 then ', ' || v_late || ' already late' else '' end || '. Most cities want the Mayor''s Permit renewed by January 20.</p>' ||
                '<ul style="padding-left:18px;margin:0 0 10px">' || v_html || '</ul>' end ||
      '<p style="margin:0;color:#4B5568;font-size:13px">Your season pass: texts until ' || private.fmt_date(s.ends_on) ||
        case when s.check_id is null then ', and one papers check you haven''t used yet (open a permit and tap "Check my papers").' else '.' end || '</p>',
      case when coalesce(v_n, 0) = 0 then 'Nothing is due before ' || private.fmt_date(s.ends_on) || '.' else v_text end,
      '#/compliance', 'seasonplan:' || s.id || ':' || p_reason || ':' || m.user_id, true);
  end loop;
  return coalesce(v_n, 0);
end $$;

-- ================================================================ invite a business
create or replace function public.invite_code(p_org uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_try int := 0;
begin
  perform private.load_ready();
  perform private.need_org_admin(p_org);
  select code into v_code from public.invite_codes where org_id = p_org;
  while v_code is null and v_try < 20 loop
    v_try := v_try + 1;
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 8));
    begin
      insert into public.invite_codes (org_id, code) values (p_org, v_code);
    exception when unique_violation then
      v_code := (select code from public.invite_codes where org_id = p_org);
    end;
  end loop;
  return v_code;
end $$;

-- A new workspace says who invited it (once, in its first 14 days, by its owner).
create or replace function public.claim_invite(p_org uuid, p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_inviter uuid; o public.orgs;
begin
  perform private.load_ready();
  select * into o from public.orgs where id = p_org and deleted_at is null;
  if o.id is null or private.member_role(p_org) is distinct from 'owner' then raise exception 'Only the new workspace''s owner can do this.' using errcode = '42501'; end if;
  if o.created_at < now() - interval '14 days' then raise exception 'Invitations count for new workspaces only (their first 14 days).' using errcode = 'P0001'; end if;
  if exists (select 1 from public.invite_signups where invited_org = p_org) then return false; end if;
  select org_id into v_inviter from public.invite_codes c join public.orgs og on og.id = c.org_id and og.deleted_at is null
    where c.code = upper(btrim(coalesce(p_code, '')));
  if v_inviter is null then raise exception 'That invitation code isn''t valid.' using errcode = 'P0002'; end if;
  if v_inviter = p_org or exists (select 1 from public.org_members m where m.org_id = v_inviter and m.user_id = auth.uid()) then
    raise exception 'You can''t use an invitation from your own workspace.' using errcode = 'P0001';
  end if;
  insert into public.invite_signups (inviter_org, invited_org, invited_user) values (v_inviter, p_org, auth.uid());
  perform private.notify_owners(v_inviter, 'A business you invited joined PermitPal',
    'Once they add 3 permits with their dates, you both get a month of PermitPal Plus.', '#/load', 'invitejoin:' || p_org, false, true);
  return true;
end $$;

-- What an inviter sees: how many joined and where each is (no names: the other business's details are theirs).
create or replace function public.my_invites(p_org uuid) returns table (joined_on date, status text, permits_with_dates int, my_reward text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'Workspace not found.' using errcode = '42501'; end if;
  return query
  select private.ph_day(s.created_at), s.status,
    least(3, (select count(*)::int from public.requirement_status rs where rs.org_id = s.invited_org and rs.expires_on is not null)), s.inviter_reward
  from public.invite_signups s where s.inviter_org = p_org order by s.created_at desc limit 100;
end $$;

-- A free month of Plus; if Plus is already paid for or comes with the plan, the same value as bonus load.
create or replace function private.give_plus_month(p_org uuid, p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.addons; v_today date := private.today_ph(); o public.orgs;
begin
  select * into o from public.orgs where id = p_org;
  select * into a from public.addons where org_id = p_org and kind = 'plus' for update;
  if (a.org_id is not null and a.paid_through >= v_today and not a.trial and not a.comped)
     or (o.kind <> 'business' and not exists (select 1 from public.addons x where x.org_id = p_org and x.kind = 'plus' and x.paid_through >= v_today) and private.has_plus(p_org)) then
    perform private.load_add(p_org, 'bonus', 0, private.addon_price('plus', null, 'monthly'), 0, 'invite', p_label, null);
    return 'bonus_load';
  end if;
  if a.org_id is not null and a.paid_through >= v_today then
    update public.addons set paid_through = (paid_through + interval '1 month')::date, updated_at = now() where org_id = p_org and kind = 'plus';
  else
    insert into public.addons (org_id, kind, billing, paid_through, trial, comped)
    values (p_org, 'plus', 'monthly', (v_today + interval '1 month')::date - 1, false, true)
    on conflict (org_id, kind) do update set paid_through = excluded.paid_through, trial = false, comped = true, updated_at = now();
    perform private.run_audit(p_org, 'start');
  end if;
  insert into public.load_entries (org_id, kind, item, label) values (p_org, 'bonus', 'invite', p_label || ': a month of PermitPal Plus');
  return 'plus_month';
end $$;

-- ================================================================ staff tools
create or replace function public.admin_save_load_product(p_code text, p_price numeric, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_price is null or p_price < 0 or p_price > 5000 then raise exception 'Enter a price from ₱0 to ₱5,000.' using errcode = '22023'; end if;
  update public.load_products set price_php = p_price, active = coalesce(p_active, active), updated_at = now() where code = p_code;
  if not found then raise exception 'Unknown product.' using errcode = 'P0002'; end if;
end $$;

-- Goodwill from staff: bonus load and/or text credits (not refundable).
create or replace function public.admin_load_gift(p_org uuid, p_amount numeric, p_texts int, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if not exists (select 1 from public.orgs where id = p_org) then raise exception 'Workspace not found.' using errcode = 'P0002'; end if;
  if coalesce(p_amount, 0) < 0 or coalesce(p_amount, 0) > 5000 or coalesce(p_texts, 0) < 0 or coalesce(p_texts, 0) > 1000
     or (coalesce(p_amount, 0) = 0 and coalesce(p_texts, 0) = 0) then
    raise exception 'Give up to ₱5,000 and/or up to 1,000 texts.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why (the customer sees it).' using errcode = '22023'; end if;
  perform private.load_add(p_org, 'bonus', 0, coalesce(p_amount, 0), coalesce(p_texts, 0), 'gift', left(btrim(p_note), 200), null);
  perform private.notify_owners(p_org, 'A gift from PermitPal',
    btrim(p_note) || ' (' || concat_ws(' and ', case when coalesce(p_amount, 0) > 0 then private.peso(p_amount) || ' load' end,
                                       case when coalesce(p_texts, 0) > 0 then p_texts || ' texts' end) || ')',
    '#/load', 'loadgift:' || p_org || ':' || extract(epoch from now())::bigint, true, true);
end $$;

-- Paying unused paid load back to the customer (they asked, or are leaving).
create or replace function public.admin_load_cashout(p_org uuid, p_amount numeric, p_method text, p_ref text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.load_wallets;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if coalesce(p_method, '') not in ('gcash','maya','bank_transfer','other') then raise exception 'Choose how you paid it back.' using errcode = '22023'; end if;
  if length(coalesce(p_ref, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  select * into w from public.load_wallets where org_id = p_org for update;
  if w.org_id is null or p_amount is null or p_amount <= 0 or p_amount > w.paid_php then
    raise exception 'You can give back up to the paid load: %.', private.peso(coalesce(w.paid_php, 0)) using errcode = '22023';
  end if;
  update public.load_wallets set paid_php = paid_php - p_amount, updated_at = now() where org_id = p_org;
  insert into public.load_entries (org_id, kind, paid_php, item, label)
  values (p_org, 'cashout', -p_amount, 'cashout:' || p_method || coalesce(':' || nullif(btrim(p_ref), ''), ''),
          'Paid back to you by ' || replace(p_method, '_', ' ') || coalesce(' (ref ' || nullif(btrim(p_ref), '') || ')', '') || coalesce('. ' || nullif(btrim(p_note), ''), ''));
  perform private.notify_owners(p_org, private.peso(p_amount) || ' of your load was paid back to you',
    'Sent by ' || replace(p_method, '_', ' ') || coalesce(', reference ' || nullif(btrim(p_ref), ''), '') || '.', '#/load',
    'loadcashout:' || p_org || ':' || extract(epoch from now())::bigint, true, true);
end $$;

-- ================================================================ what the app shows
create or replace function public.load_summary(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w public.load_wallets; s public.season_passes; v_season int := private.season_for(private.today_ph()); v_src text; v jsonb;
begin
  if p_org not in (select private.my_org_ids()) then raise exception 'Workspace not found.' using errcode = '42501'; end if;
  select * into w from public.load_wallets where org_id = p_org;
  select * into s from public.season_passes where org_id = p_org and private.today_ph() <= ends_on order by starts_on desc limit 1;
  v_src := private.text_source(p_org);
  select jsonb_build_object(
    'paid', coalesce(w.paid_php, 0), 'bonus', coalesce(w.bonus_php, 0), 'total', coalesce(w.paid_php, 0) + coalesce(w.bonus_php, 0),
    'texts', coalesce(w.texts, 0), 'text_source', v_src,
    'plan_texts', coalesce((select pl.paid_channels from public.plans pl where pl.id = private.effective_plan_id(p_org)), false),
    'sms_ready', coalesce((nullif(private.setting('channel_status'), '')::jsonb ->> 'sms'), 'false') = 'true',
    'phones', (select count(*) from public.org_members m join public.profiles pr on pr.id = m.user_id
               where m.org_id = p_org and m.role <> 'viewer' and pr.phone is not null and pr.phone_verified_at is not null),
    'my_phone', exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.phone_verified_at is not null),
    'texts_month', (select count(*) from public.message_outbox m where m.org_id = p_org and m.channel = 'sms' and m.status not in ('skipped','failed')
                    and m.created_at >= date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'),
    'pass', case when s.id is null then null else jsonb_build_object('id', s.id, 'season', s.season, 'starts_on', s.starts_on, 'ends_on', s.ends_on,
      'texts_cap', s.texts_cap, 'check_used', s.check_id is not null,
      'texts_used', (select count(*) from public.message_outbox m where m.org_id = p_org and m.channel = 'sms' and m.text_source = 'season'
                     and m.status not in ('skipped','failed') and m.created_at >= (s.starts_on::timestamp at time zone 'Asia/Manila'))) end,
    'season_on_sale', case when v_season is not null and not exists (select 1 from public.season_passes x where x.org_id = p_org and x.season = v_season)
                           and private.load_on_sale('season_pass') then v_season end,
    'season_ends', case when v_season is not null then make_date(v_season, 3, 1) - 1 end,
    'has_plus', private.has_plus(p_org),
    'can_spend', private.is_org_admin(p_org),
    'invites', case when private.is_org_admin(p_org) then jsonb_build_object(
        'joined', (select count(*) from public.invite_signups where inviter_org = p_org),
        'rewarded', (select count(*) from public.invite_signups where inviter_org = p_org and status = 'rewarded'),
        'pending', (select count(*) from public.invite_signups where inviter_org = p_org and status = 'pending'),
        'invited_by', (select jsonb_build_object('status', x.status, 'reward', x.invited_reward,
                        'permits', least(3, (select count(*) from public.requirement_status rs where rs.org_id = p_org and rs.expires_on is not null)))
                       from public.invite_signups x where x.invited_org = p_org)) end
  ) into v;
  return v;
end $$;

-- ================================================================ every morning
create or replace function private.load_daily() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_n int := 0; c record; s record; v_r1 text; v_r2 text; v_year int := extract(year from private.today_ph())::int;
begin
  if not exists (select 1 from private.features where name = 'load') then return 0; end if;
  -- top-ups nobody paid
  update public.load_topups set status = 'cancelled', note = 'Not paid in time. Start a new top-up whenever you like.'
  where status = 'due' and valid_until < v_today;

  -- papers checks not answered in time: the load comes back by itself
  for c in select * from public.papers_checks where status = 'waiting' and due_by < now() loop
    perform private.papers_refund(c.id, 'refunded', 'Not answered in time, so it''s free.');
    perform private.notify_owners(c.org_id, 'Papers check refunded: ' || c.requirement_name,
      'We didn''t answer in time, so ' || case when c.paid_with = 'pass' then 'your season pass''s check is free to use again.' else 'the ' || private.peso(c.price_php) || ' is back in your load.' end ||
      ' Sorry about that.', '#/requirement/' || c.requirement_id, 'paperslate:' || c.id, true, true);
    perform private.notify_admins('Papers check refunded automatically: ' || c.requirement_name, 'Not answered by ' ||
      to_char(c.due_by at time zone 'Asia/Manila', 'Dy Mon FMDD, FMHH12:MI am') || '.', 'paperslate:' || c.id, false);
    v_n := v_n + 1;
  end loop;

  -- the season plan on December 1 and January 5
  if to_char(v_today, 'MM-DD') in ('12-01', '01-05') then
    for s in select id from public.season_passes where v_today between starts_on and ends_on and starts_on < v_today loop
      perform private.season_plan(s.id, case when extract(month from v_today) = 12 then 'dec' else 'jan' end);
    end loop;
  end if;

  -- invitations: once the invited business has 3 permits with dates (a day after joining, email confirmed), both get a month of Plus
  for c in
    select x.* from public.invite_signups x join public.orgs o on o.id = x.invited_org and o.deleted_at is null
    join public.orgs i on i.id = x.inviter_org and i.deleted_at is null
    where x.status = 'pending' and x.created_at < now() - interval '1 day'
      and exists (select 1 from auth.users u where u.id = x.invited_user and u.email_confirmed_at is not null)
      and (select count(*) from public.requirement_status rs where rs.org_id = x.invited_org and rs.expires_on is not null) >= 3
    for update of x
  loop
    v_r2 := private.give_plus_month(c.invited_org, 'Welcome gift for joining by invitation');
    if (select count(*) from public.invite_signups y where y.inviter_org = c.inviter_org and y.inviter_reward in ('plus_month','bonus_load')
          and extract(year from y.rewarded_at at time zone 'Asia/Manila') = v_year) >= 6 then
      v_r1 := 'capped';
    else
      v_r1 := private.give_plus_month(c.inviter_org, 'Thank you for inviting a business');
    end if;
    update public.invite_signups set status = 'rewarded', inviter_reward = v_r1, invited_reward = v_r2, rewarded_at = now() where id = c.id;
    perform private.notify_owners(c.invited_org, 'Your welcome gift is here',
      case v_r2 when 'plus_month' then 'You have a month of PermitPal Plus, free.' else private.peso(private.addon_price('plus', null, 'monthly')) || ' bonus load is in your load.' end,
      '#/load', 'invitegift:' || c.id, true, true);
    perform private.notify_owners(c.inviter_org, 'Thank you for inviting a business',
      case v_r1 when 'plus_month' then 'They''re set up, so you both get a month of PermitPal Plus, free.'
                when 'bonus_load' then 'They''re set up. You already have Plus, so ' || private.peso(private.addon_price('plus', null, 'monthly')) || ' bonus load is in your load.'
                else 'They''re set up and got their gift. You''ve reached this year''s 6 thank-you months: thank you for spreading the word!' end,
      '#/load', 'invitethanks:' || c.id, true, true);
    v_n := v_n + 1;
  end loop;
  -- invitations that never got going
  update public.invite_signups set status = 'void', reason = 'The invited business didn''t add 3 permits within 90 days.'
  where status = 'pending' and created_at < now() - interval '90 days';
  return v_n;
end $$;

-- ================================================================ reminders: texts paid by the plan, a season pass or credits
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
    select g.*, p.email, p.phone, p.first_name, o.name as org_name, private.client_brand_json(g.org_id) as brand,
      coalesce(np.email_enabled, true) as email_on, coalesce(np.sms_enabled, false) as sms_on,
      coalesce(np.whatsapp_enabled, false) as wa_on,
      coalesce((select pl.paid_channels from public.plans pl where pl.id = private.effective_plan_id(g.org_id)), false) as paid,
      private.text_source(g.org_id) is not null as texts
    from grouped g
    join public.profiles p on p.id = g.user_id
    join public.orgs o on o.id = g.org_id
    left join public.notification_prefs np on np.user_id = g.user_id
  ), msgs as (
    select r.org_id, r.user_id, 'email' as channel, r.email as to_address,
      coalesce(r.brand ->> 'name', 'PermitPal') || ': ' || case when r.n = 1 then r.first_title else r.n || ' items need attention (' || r.org_name || ')' end as subject,
      'These need attention in ' || r.org_name || E':\n' || r.items_text || E'\n\nOpen PermitPal: ' || v_app || coalesce(E'\n\nSent for ' || (r.brand ->> 'name') || ' by PermitPal.', '') as body_text,
      private.email_html_b(r.brand, case when r.n = 1 then r.first_title else r.n || ' items need attention' end,
        '<p style="margin:0 0 8px">In <b>' || private.html_escape(r.org_name) || '</b>:</p><ul style="padding-left:18px;margin:0">' || r.items_html || '</ul>',
        'Open PermitPal', v_app) as body_html,
      null::text as template, null::jsonb as template_params,
      'remmail:' || r.user_id || ':' || r.org_id || ':' || v_today as dedupe_key, r.brand ->> 'name' as from_name, r.brand ->> 'reply_to' as reply_to
    from recipients r where r.email_on and r.email is not null
    union all
    select r.org_id, r.user_id, 'sms', r.phone, null,
      left('PermitPal: ' || r.first_title || case when r.n > 1 then ' +' || (r.n - 1) || ' more' else '' end || '. ' || v_app, 300),
      null, null, null,
      'remsms:' || r.user_id || ':' || r.org_id || ':' || v_today, null, null
    from recipients r where r.sms_on and r.texts and r.phone is not null
    union all
    select r.org_id, r.user_id, 'whatsapp', r.phone, null,
      r.first_title || case when r.n > 1 then ' +' || (r.n - 1) || ' more' else '' end,
      null, 'permit_reminder',
      jsonb_build_array(coalesce(nullif(r.first_name, ''), 'there'), r.n::text, r.first_title, v_app),
      'remwa:' || r.user_id || ':' || r.org_id || ':' || v_today, null, null
    from recipients r where r.wa_on and r.paid and r.phone is not null
  )
  insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, template, template_params, dedupe_key, from_name, reply_to)
  select * from msgs
  on conflict (dedupe_key) do nothing;
  get diagnostics v_new = row_count;

  -- 1b. Escalations to owners/admins for permits someone else is handling.
  perform private.queue_escalations();

  -- 3. Monday weekly digest (email only): a summary of everything not compliant.
  if extract(isodow from v_today) = 1 then
    insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, dedupe_key, from_name, reply_to)
    select d.org_id, d.user_id, 'email', d.email,
      coalesce(bj.brand ->> 'name', 'PermitPal') || ' weekly summary: ' || d.org_name,
      d.overdue || ' overdue, ' || d.soon || ' due within 30 days, ' || d.needinfo || ' need information, ' || d.inprog || ' in progress. ' || v_app,
      private.email_html_b(bj.brand, 'Your week in compliance: ' || d.org_name,
        '<table style="width:100%;border-collapse:collapse;font-size:14px">'
        || '<tr><td style="padding:6px 0">Overdue</td><td style="text-align:right;font-weight:700;color:#D8433C">' || d.overdue || '</td></tr>'
        || '<tr><td style="padding:6px 0">Due within 30 days</td><td style="text-align:right;font-weight:700;color:#DF9A1F">' || d.soon || '</td></tr>'
        || '<tr><td style="padding:6px 0">Need information</td><td style="text-align:right;font-weight:700">' || d.needinfo || '</td></tr>'
        || '<tr><td style="padding:6px 0">Renewals in progress</td><td style="text-align:right;font-weight:700;color:#2F6FED">' || d.inprog || '</td></tr>'
        || '<tr><td style="padding:6px 0">Compliant</td><td style="text-align:right;font-weight:700;color:#1D9C57">' || d.ok || '</td></tr></table>',
        'Open PermitPal', v_app),
      'digest:' || d.user_id || ':' || d.org_id || ':' || to_char(v_today, 'IYYY-IW'), bj.brand ->> 'name', bj.brand ->> 'reply_to'
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
    ) d cross join lateral (select private.client_brand_json(d.org_id) as brand) bj
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

-- Tax and contribution deadlines are texted too, on the days they're emailed.
CREATE OR REPLACE FUNCTION private.queue_filing_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := private.today_ph(); v_n int := 0; v record; v_start timestamptz := now(); v_app text := private.setting('app_url');
begin
  for v in
    select o.*, t.agency, t.form, t.name as fname, t.frequency, m.user_id,
      case when o.due_on < v_today then 'over-' || ((v_today - o.due_on - 1) / 7)
           when o.due_on - v_today <= 1 then 'd1' else 'd7' end as stage
    from private.filing_obligations(null, v_today - 56, v_today + 7) o
    join public.filing_types t on t.code = o.code
    join public.org_members m on m.org_id = o.org_id and m.role <> 'viewer'
    left join public.notification_prefs np on np.user_id = m.user_id
    where o.due_on >= o.tracking_from and coalesce(np.business_alerts, true)
      and not exists (select 1 from public.filing_records r where r.business_id = o.business_id and r.code = o.code and r.period_start = o.period_start)
  loop
    perform private.notify(v.user_id, v.org_id, 'filing',
      case when v.agency in ('BIR','SEC') then v.agency || ' ' || v.form else v.fname end || ' for ' || private.filing_period_label(v.frequency, v.code, v.period_start)
        || case when v.due_on < v_today then ' is overdue' when v.due_on = v_today then ' is due today' else ' is due ' || private.fmt_date(v.due_on) end,
      v.business_name || ' - ' || v.fname || '. Mark it filed in PermitPal once it''s done.',
      '#/filings', null, 'fil:' || v.business_id || ':' || v.code || ':' || v.period_start || ':' || v.stage || ':' || v.user_id,
      v.stage in ('d7', 'd1', 'over-0'));
    v_n := v_n + 1;
  end loop;
  -- One text per person per workspace for the deadlines emailed today (when their plan, pass or credits cover texts).
  insert into public.message_outbox (org_id, user_id, channel, to_address, body_text, dedupe_key)
  select n.org_id, n.user_id, 'sms', p.phone,
    left('PermitPal: ' || (array_agg(n.title order by n.title))[1] || case when count(*) > 1 then ' +' || (count(*) - 1) || ' more' else '' end || '. ' || coalesce(v_app, ''), 300),
    'filsms:' || n.user_id || ':' || n.org_id || ':' || v_today
  from public.notifications n
  join public.profiles p on p.id = n.user_id and p.phone is not null and p.phone_verified_at is not null
  join public.notification_prefs np on np.user_id = n.user_id and np.sms_enabled
  where n.kind = 'filing' and n.created_at >= v_start and n.dedupe_key ~ ':(d7|d1|over-0):[0-9a-f-]+$'
    and private.text_source(n.org_id) is not null
  group by n.org_id, n.user_id, p.phone
  on conflict (dedupe_key) do nothing;
  return v_n;
end $function$;

-- ================================================================ templates: with Plus, or bought one by one
CREATE OR REPLACE FUNCTION public.get_template(p_org uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.doc_templates;
begin
  if p_org not in (select private.my_org_ids()) then raise exception 'Workspace not found.' using errcode = '42501'; end if;
  if not private.has_plus(p_org) and not exists (select 1 from public.template_unlocks u where u.org_id = p_org and u.code = p_code) then
    raise exception 'Ready-to-use templates come with PermitPal Plus, or one at a time with your load.' using errcode = 'P0001', hint = 'plus';
  end if;
  select * into t from public.doc_templates where code = p_code;
  if t.code is null then raise exception 'Template not found.' using errcode = 'P0002'; end if;
  insert into private.template_uses (org_id, user_id, code) values (p_org, auth.uid(), t.code);
  return jsonb_build_object('code', t.code, 'title', t.title, 'body', t.body, 'fields', t.fields, 'notarize', t.notarize, 'version', t.version, 'use_when', t.use_when);
end $function$;

-- ================================================================ staff opening files: papers checks and top-up proofs too
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
  elsif v_parts[2] = 'load' then
    select 'Payment proof, load top-up ' || t.number into v_reason from public.load_topups t where t.org_id = v_org and t.id::text = v_parts[3] and t.proof_path = p_path;
    if v_reason is null then raise exception 'This file is not part of a top-up.' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  elsif v_parts[2] = 'papers' then
    select 'Papers check: ' || c.requirement_name, f.file_name into v_reason, v_name
      from public.papers_check_files f join public.papers_checks c on c.id = f.check_id
      where f.storage_path = p_path and c.org_id = v_org and c.id::text = v_parts[3]
        and (c.status = 'waiting' or (c.status = 'answered' and c.answered_at > now() - interval '7 days'));
    if v_reason is null then raise exception 'You can only open papers while their check is open (or for 7 days after answering).' using errcode = '42501'; end if;
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
    if v_name is null then
      -- the permit's own documents, while a papers check for it is open
      select d.file_name, 'Papers check: ' || c.requirement_name into v_name, v_reason
        from public.documents d
        join public.papers_checks c on c.requirement_id = d.requirement_id
          and (c.status = 'waiting' or (c.status = 'answered' and c.answered_at > now() - interval '7 days'))
        where d.storage_path = p_path and d.org_id = v_org and d.deleted_at is null
        limit 1;
    end if;
    if v_name is null then raise exception 'You can only open a customer''s files while they have an open request for that permit.' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.org_members m where m.org_id = v_org and m.user_id = auth.uid()) then
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), 'PermitPal staff') into v_staff from public.profiles p where p.id = auth.uid();
    insert into public.staff_file_access (org_id, staff_id, staff_name, file_path, file_name, reason)
    values (v_org, auth.uid(), coalesce(v_staff, 'PermitPal staff'), p_path, regexp_replace(v_name, '^[a-z0-9]{6,}-', ''),
      case when v_parts[2] in ('care','billing','load') or v_reason like 'Papers check: %' then v_reason else 'Request: ' || v_reason end);
  end if;
  return v_name;
end $function$;

-- ================================================================ online checkout for top-ups
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
  if p_plan like 'load:%' then return private.load_payment_start(p_org, p_plan); end if;
  if private.member_role(p_org) is distinct from 'owner' then
    raise exception 'Only the workspace owner can change the plan.' using errcode = '42501';
  end if;
  select * into v_plan from public.plans where id = p_plan;
  if v_plan.id is null or coalesce(v_plan.price_php_monthly, 0) <= 0 then
    raise exception 'That plan is not available for online payment yet.' using errcode = 'P0001';
  end if;
  if p_plan = 'property_s' and private.tenant_count(p_org) > 20 then
    raise exception 'You have % tenants. Small property covers up to 20: choose Mall & property.', private.tenant_count(p_org) using errcode = 'P0001', hint = 'tenant_limit';
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
  if v_pay.load_topup_id is not null then
    perform private.load_topup_paid(v_pay.load_topup_id, 'online', p_checkout_id);
    return;
  end if;
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

-- ================================================================ money views: load top-ups and pay-backs
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
    -- PermitPal Plus and staff licenses
    select private.ph_day(i.paid_at), 'plans', case i.kind when 'plus' then 'plus' when 'brand' then 'white_label' else 'staff_licences' end, 'collected', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, i.bir_invoice_no, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status = 'paid' and i.amount_php > 0 and i.paid_at is not null
    union all
    select private.ph_day(i.created_at), 'plans', case i.kind when 'plus' then 'plus' when 'brand' then 'white_label' else 'staff_licences' end, 'to_collect', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, null, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status in ('due','pending_verification') and i.amount_php > 0
    union all
    -- PermitPal load: top-ups are money in (spending it later isn't new money); paying it back is money out
    select private.ph_day(t.paid_at), 'load', 'load_topup', 'collected', t.amount_php::numeric, 'Load top-up ' || t.number, o.name, 'load', t.id, t.bir_invoice_no, 0
    from public.load_topups t join public.orgs o on o.id = t.org_id where t.status = 'paid' and t.paid_at is not null
    union all
    select private.ph_day(t.created_at), 'load', 'load_topup', 'to_collect', t.amount_php::numeric, 'Load top-up ' || t.number, o.name, 'load', t.id, null, 0
    from public.load_topups t join public.orgs o on o.id = t.org_id where t.status in ('due','pending_verification')
    union all
    select private.ph_day(e.created_at), 'load', 'refund', 'collected', e.paid_php::numeric, e.label, o.name, 'loadorg', e.org_id, null, 0
    from public.load_entries e join public.orgs o on o.id = e.org_id where e.kind = 'cashout'
  )
  select l.day, l.stream, l.kind, l.state, l.amount, l.label, l.who, l.ref_kind, l.ref_id, l.invoice_no, l.rush from lines l
  where l.day between p_from and p_to or l.state in ('to_collect','pipeline','unbilled','to_pay')
  order by l.day desc, l.stream;
end $function$;

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
    'brand_paying', (select count(*) from public.addons where kind = 'brand' and not trial and not comped and paid_through >= v_today),
    'brand_trials', (select count(*) from public.addons where kind = 'brand' and trial and paid_through >= v_today),
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
    'load_topups_to_check', (select count(*) from public.load_topups where status = 'pending_verification'),
    'load_held', coalesce((select sum(paid_php) from public.load_wallets), 0),
    'load_bonus', coalesce((select sum(bonus_php) from public.load_wallets), 0),
    'load_used_month', coalesce((select -sum(paid_php) from public.load_entries where kind in ('spend','refund')
                          and created_at >= date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'), 0),
    'papers_waiting', (select count(*) from public.papers_checks where status = 'waiting'),
    'papers_due_today', (select count(*) from public.papers_checks where status = 'waiting' and private.ph_day(due_by) <= v_today),
    'missing_invoice', (select count(*) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and coalesce(quote_php, 0) > 0 and bir_invoice_no is null)
                     + (select count(*) from public.care_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
                     + (select count(*) from public.partner_statements where status = 'paid' and bir_invoice_no is null)
                     + (select count(*) from public.payments where status = 'paid' and plan_id is not null and bir_invoice_no is null)
                     + (select count(*) from public.partner_credits where kind = 'topup' and bir_invoice_no is null)
                     + (select count(*) from public.addon_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
                     + (select count(*) from public.load_topups where status = 'paid' and bir_invoice_no is null)
  ) into v;
  return v;
end $function$;

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
  elsif p_kind = 'load' then update public.load_topups set bir_invoice_no = v_no where id = p_id and status = 'paid';
  elsif p_kind = 'credit' then update public.partner_credits set bir_invoice_no = v_no where id = p_id and kind = 'topup';
  else raise exception 'Unknown payment.' using errcode = '22023'; end if;
  if not found then raise exception 'Payment not found.' using errcode = 'P0002'; end if;
end $function$;

-- ================================================================ who may call what
do $$ declare f text; begin
  foreach f in array array['public.load_topup_start(uuid,numeric)', 'public.load_topup_report(uuid,text,text,text,text)', 'public.load_topup_cancel(uuid)',
    'public.buy_texts(uuid,text)', 'public.unlock_template(uuid,text)', 'public.request_papers_check(uuid,uuid,text)', 'public.add_papers_check_file(uuid,text,text,text)',
    'public.cancel_papers_check(uuid)', 'public.buy_season_pass(uuid)', 'public.invite_code(uuid)', 'public.claim_invite(uuid,text)', 'public.my_invites(uuid)',
    'public.load_summary(uuid)', 'public.admin_confirm_topup(uuid,boolean,text,text)', 'public.admin_answer_papers_check(uuid,text,jsonb,text)',
    'public.admin_refund_papers_check(uuid,text)', 'public.admin_save_load_product(text,numeric,boolean)', 'public.admin_load_gift(uuid,numeric,integer,text)',
    'public.admin_load_cashout(uuid,numeric,text,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['private.load_price(text)', 'private.load_on_sale(text)', 'private.load_ready()', 'private.need_org_admin(uuid)',
    'private.load_add(uuid,text,numeric,numeric,integer,text,text,uuid)', 'private.load_spend(uuid,numeric,text,text,uuid,integer)',
    'private.load_give_back(uuid,uuid,text)', 'private.load_topup_paid(uuid,text,text)', 'private.load_payment_start(uuid,text)', 'private.text_source(uuid)',
    'private.papers_refund(uuid,text,text)', 'private.season_plan(uuid,text)', 'private.give_plus_month(uuid,text)', 'private.load_daily()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ================================================================ every morning, 7:20 am Manila
select cron.schedule('pp-load-daily', '20 23 * * *', $$select private.load_daily()$$);

insert into private.features (name) values ('load') on conflict do nothing;
