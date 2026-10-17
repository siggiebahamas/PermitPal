-- Government filing deadlines (BIR, SSS, PhilHealth, Pag-IBIG, SEC), per business.
-- The owner answers a few plain questions (employees? VAT or percentage tax? withholding on rent or
-- suppliers?), and PermitPal works out every recurring return and contribution, when each is due,
-- reminds the team, and keeps a record of what was filed (date, reference number, amount).
-- Rules are deliberately conservative: when sources disagree we use the earlier date, and a deadline
-- that falls on a weekend or holiday is still shown on its calendar date. Calendar-year taxpayers only.

-- ================================================================ the list of filings
create table public.filing_types (
  code        text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  agency      text not null check (agency in ('BIR','SSS','PhilHealth','Pag-IBIG','SEC')),
  form        text not null,
  name        text not null,
  frequency   text not null check (frequency in ('monthly','quarterly','annual')),
  applies     text not null check (applies in ('employer','withholding','vat','percentage','individual','corp','sec_gis')),
  rule        text not null check (rule in ('next10','next10_dec15','q_next_last','q_25','q_1701','q_60','a_apr15','a_jan31','a_mar1','a_apr30','m_sss','m_philhealth','m_pagibig','gis')),
  months      int[],   -- monthly filings only in these months (null = every month)
  quarters    int[],   -- quarterly filings only for these quarters (null = all four)
  help_text   text not null,
  online_url  text check (online_url is null or online_url ~ '^https://'),
  online_label text,
  sort        int not null default 100
);
alter table public.filing_types enable row level security;
create policy filing_types_read on public.filing_types for select to authenticated using (true);
revoke insert, update, delete, truncate on public.filing_types from anon, authenticated;

insert into public.filing_types (code, agency, form, name, frequency, applies, rule, months, quarters, help_text, online_url, online_label, sort) values
  ('bir_1601c', 'BIR', '1601-C', 'Tax withheld from employees'' pay', 'monthly', 'employer', 'next10_dec15', null, null,
   'The income tax you withheld from salaries. Due the 10th of the next month (January 15 for December).', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 10),
  ('bir_0619e', 'BIR', '0619-E', 'Tax withheld from rent and suppliers (monthly)', 'monthly', 'withholding', 'next10', array[1,2,4,5,7,8,10,11], null,
   'Expanded withholding tax for the first two months of each quarter. Due the 10th of the next month.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 20),
  ('bir_1601eq', 'BIR', '1601-EQ', 'Tax withheld from rent and suppliers (quarterly return)', 'quarterly', 'withholding', 'q_next_last', null, null,
   'Expanded withholding tax for the whole quarter. Due the last day of the month after the quarter.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 30),
  ('bir_2550q', 'BIR', '2550Q', 'Quarterly VAT return', 'quarterly', 'vat', 'q_25', null, null,
   'For VAT-registered businesses. Due the 25th day after the quarter ends.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 40),
  ('bir_2551q', 'BIR', '2551Q', 'Quarterly percentage tax', 'quarterly', 'percentage', 'q_25', null, null,
   'For non-VAT businesses that pay percentage tax. Due the 25th day after the quarter ends. Not needed if you chose the 8% income tax rate.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 50),
  ('bir_1701q', 'BIR', '1701Q', 'Quarterly income tax (sole proprietor)', 'quarterly', 'individual', 'q_1701', null, array[1,2,3],
   'Due May 15, August 15 and November 15. The fourth quarter goes in the yearly return.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 60),
  ('bir_1701', 'BIR', '1701 / 1701A', 'Yearly income tax (sole proprietor)', 'annual', 'individual', 'a_apr15', null, null,
   'For the year just ended. Due April 15.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 70),
  ('bir_1702q', 'BIR', '1702Q', 'Quarterly income tax (corporation or partnership)', 'quarterly', 'corp', 'q_60', null, array[1,2,3],
   'Due 60 days after each of the first three quarters ends. The fourth quarter goes in the yearly return.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 80),
  ('bir_1702', 'BIR', '1702', 'Yearly income tax (corporation or partnership)', 'annual', 'corp', 'a_apr15', null, null,
   'For the year just ended, with the audited financial statements. Due April 15.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 90),
  ('bir_1604c', 'BIR', '1604-C', 'Yearly summary of tax withheld from employees', 'annual', 'employer', 'a_jan31', null, null,
   'With the list of employees. Due January 31. Give employees their Form 2316 by then too.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 100),
  ('bir_1604e', 'BIR', '1604-E', 'Yearly summary of tax withheld from rent and suppliers', 'annual', 'withholding', 'a_mar1', null, null,
   'With the list of payees. Due March 1.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 110),
  ('sss_contrib', 'SSS', 'Contributions', 'SSS contributions', 'monthly', 'employer', 'm_sss', null, null,
   'Employee and employer shares for the month. Due by the end of the next month. If the payment reference number (PRN) from My.SSS shows an earlier date, go by the PRN.', 'https://www.sss.gov.ph/', 'SSS website (My.SSS)', 200),
  ('philhealth_contrib', 'PhilHealth', 'Premium', 'PhilHealth premium', 'monthly', 'employer', 'm_philhealth', null, null,
   'Due by the 15th of the next month if your PhilHealth employer number (PEN) ends in 0 to 4, or by the 20th if it ends in 5 to 9.', 'https://www.philhealth.gov.ph/', 'PhilHealth website', 210),
  ('pagibig_contrib', 'Pag-IBIG', 'Contributions', 'Pag-IBIG contributions', 'monthly', 'employer', 'm_pagibig', null, null,
   'Due date depends on the first letter of your employer name: A to D by the 14th of the next month, E to L by the 19th, M to Q by the 24th, R to Z and numbers by the end of the month.', 'https://www.pagibigfund.gov.ph/', 'Pag-IBIG Fund website', 220),
  ('sec_afs', 'SEC', 'AFS', 'Audited financial statements', 'annual', 'corp', 'a_apr30', null, null,
   'For companies whose year ends December 31. The SEC sets the exact date each year by the last digit of your SEC registration number; we remind you by April 30 to be safe.', 'https://efast.sec.gov.ph/', 'SEC eFAST', 300),
  ('sec_gis', 'SEC', 'GIS', 'General Information Sheet', 'annual', 'sec_gis', 'gis', null, null,
   'Due within 30 days after your annual stockholders'' or members'' meeting.', 'https://efast.sec.gov.ph/', 'SEC eFAST', 310);

-- ================================================================ each business's answers
create table public.filing_setup (
  business_id      uuid primary key references public.businesses(id) on delete cascade,
  org_id           uuid not null references public.orgs(id) on delete cascade,
  has_employees    boolean not null default false,
  withholds        boolean not null default false,
  tax_type         text not null default 'unsure' check (tax_type in ('vat','percentage','eight_percent','unsure')),
  philhealth_digit smallint check (philhealth_digit between 0 and 9),
  pagibig_group    text check (pagibig_group in ('A-D','E-L','M-Q','R-Z')),
  annual_meeting   date,           -- only the month and day are used
  paused_codes     text[] not null default '{}',  -- filings they told us don't apply to them
  tracking_from    date not null,  -- due dates before this aren't listed (a month before setup, so recent ones can be ticked off)
  updated_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index filing_setup_org on public.filing_setup(org_id);
alter table public.filing_setup enable row level security;
create policy filing_setup_read on public.filing_setup for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete, truncate on public.filing_setup from anon, authenticated;
revoke all on public.filing_setup from anon;

-- ================================================================ what was filed
create table public.filing_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  code          text not null references public.filing_types(code),
  period_start  date not null check (period_start = date_trunc('month', period_start)::date),
  filed_on      date not null,
  reference     text check (reference is null or length(reference) <= 100),
  amount        numeric(14,2) check (amount is null or amount >= 0),
  note          text check (note is null or length(note) <= 500),
  filed_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (business_id, code, period_start)
);
create index filing_records_org on public.filing_records(org_id, filed_on desc);
alter table public.filing_records enable row level security;
create policy filing_records_read on public.filing_records for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete, truncate on public.filing_records from anon, authenticated;
revoke all on public.filing_records from anon;

-- ================================================================ the rules
-- Pag-IBIG's group from the employer name's first letter or digit.
create or replace function private.pagibig_group(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when l between 'A' and 'D' then 'A-D' when l between 'E' and 'L' then 'E-L' when l between 'M' and 'Q' then 'M-Q' else 'R-Z' end
  from (select upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'), 1)) as l) x
$$;

-- When a filing for the period starting p_period is due.
create or replace function private.filing_due(p_rule text, p_period date, p_digit smallint, p_group text, p_meeting date) returns date
language sql immutable set search_path = '' as $$
  select case p_rule
    when 'next10' then nm + 9
    when 'next10_dec15' then case when extract(month from p_period) = 12 then make_date(y + 1, 1, 15) else nm + 9 end
    when 'q_next_last' then (ms + interval '4 months')::date - 1
    when 'q_25' then (ms + interval '3 months')::date + 24
    when 'q_1701' then make_date(y, extract(month from ms)::int + 4, 15)
    when 'q_60' then (ms + interval '3 months')::date - 1 + 60
    when 'a_apr15' then make_date(y + 1, 4, 15)
    when 'a_jan31' then make_date(y + 1, 1, 31)
    when 'a_mar1' then make_date(y + 1, 3, 1)
    when 'a_apr30' then make_date(y + 1, 4, 30)
    when 'm_sss' then (ms + interval '2 months')::date - 1
    when 'm_philhealth' then nm + case when p_digit >= 5 then 19 else 14 end  -- unknown digit: the earlier date
    when 'm_pagibig' then case coalesce(p_group, 'A-D') when 'A-D' then nm + 13 when 'E-L' then nm + 18 when 'M-Q' then nm + 23
                                                        else (ms + interval '2 months')::date - 1 end
    when 'gis' then case when p_meeting is null then null else
      make_date(y, extract(month from p_meeting)::int,
        least(extract(day from p_meeting)::int, extract(day from (make_date(y, extract(month from p_meeting)::int, 1) + interval '1 month - 1 day'))::int)) + 30 end
  end
  from (select date_trunc('month', p_period)::date as ms, (date_trunc('month', p_period) + interval '1 month')::date as nm,
               extract(year from p_period)::int as y) x
$$;

create or replace function private.filing_period_label(p_frequency text, p_code text, p_period date) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_code = 'sec_gis' then extract(year from p_period)::int || ' meeting'
    when p_frequency = 'monthly' then to_char(p_period, 'FMMonth YYYY')
    when p_frequency = 'quarterly' then 'Q' || ((extract(month from p_period)::int + 2) / 3) || ' ' || extract(year from p_period)::int
    else extract(year from p_period)::int::text end
$$;

-- Every filing that applies, for every set-up business (or one workspace), due between two dates.
create or replace function private.filing_obligations(p_org uuid, p_from date, p_to date)
returns table (org_id uuid, business_id uuid, business_name text, code text, period_start date, due_on date, tracking_from date)
language sql stable security definer set search_path = '' as $$
  select s.org_id, s.business_id, b.name, t.code, p.ps::date, d.due_on, s.tracking_from
  from public.filing_setup s
  join public.businesses b on b.id = s.business_id and b.deleted_at is null
  join public.orgs o on o.id = s.org_id and o.deleted_at is null
  join public.filing_types t on (
       (t.applies = 'employer' and s.has_employees)
    or (t.applies = 'withholding' and s.withholds)
    or (t.applies = 'vat' and s.tax_type = 'vat')
    or (t.applies = 'percentage' and s.tax_type = 'percentage')
    or (t.applies = 'individual' and b.structure = 'Sole Proprietorship')
    or (t.applies = 'corp' and b.structure in ('Corporation','Partnership'))
    or (t.applies = 'sec_gis' and b.structure = 'Corporation' and s.annual_meeting is not null))
  cross join lateral generate_series(date_trunc('month', p_from - interval '16 months'), date_trunc('month', p_to::timestamp), interval '1 month') as p(ps)
  cross join lateral (select private.filing_due(t.rule, p.ps::date, s.philhealth_digit,
                        coalesce(s.pagibig_group, private.pagibig_group(b.name)), s.annual_meeting) as due_on) d
  where (p_org is null or s.org_id = p_org)
    and not (t.code = any (s.paused_codes))
    and case t.frequency
          when 'monthly' then t.months is null or extract(month from p.ps)::int = any (t.months)
          when 'quarterly' then extract(month from p.ps)::int in (1,4,7,10)
                                and (t.quarters is null or ((extract(month from p.ps)::int + 2) / 3) = any (t.quarters))
          else extract(month from p.ps)::int = 1
        end
    and d.due_on between p_from and p_to
$$;
revoke all on function private.filing_obligations(uuid, date, date) from public, anon, authenticated;

-- The Taxes & contributions page: what is due (and what was filed) between two dates.
create or replace function public.filing_calendar(p_org uuid, p_from date, p_to date)
returns table (business_id uuid, business_name text, code text, period_start date, period_label text, due_on date, tracking_from date,
               record_id uuid, filed_on date, reference text, amount numeric, note text, filed_by uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org is null or p_org not in (select private.my_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'Choose a shorter date range.' using errcode = '22023'; end if;
  return query
    select o.business_id, o.business_name, o.code, o.period_start, private.filing_period_label(t.frequency, t.code, o.period_start),
      o.due_on, o.tracking_from, r.id, r.filed_on, r.reference, r.amount, r.note, r.filed_by
    from private.filing_obligations(p_org, p_from, p_to) o
    join public.filing_types t on t.code = o.code
    left join public.filing_records r on r.business_id = o.business_id and r.code = o.code and r.period_start = o.period_start
    where o.due_on >= o.tracking_from or r.id is not null
    order by o.due_on, t.sort, o.business_name;
end $$;
revoke all on function public.filing_calendar(uuid, date, date) from public, anon;
grant execute on function public.filing_calendar(uuid, date, date) to authenticated;

-- ================================================================ saving answers and records
create or replace function public.save_filing_setup(p_business uuid, p_has_employees boolean, p_withholds boolean, p_tax_type text,
  p_philhealth_digit smallint default null, p_pagibig_group text default null, p_annual_meeting date default null, p_paused text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.businesses where id = p_business and deleted_at is null;
  if v_org is null or v_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if coalesce(p_tax_type, '') not in ('vat','percentage','eight_percent','unsure') then raise exception 'Choose how the business pays business tax.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_paused, '{}')) c where c not in (select code from public.filing_types)) then
    raise exception 'Unknown filing.' using errcode = '22023';
  end if;
  insert into public.filing_setup as s (business_id, org_id, has_employees, withholds, tax_type, philhealth_digit, pagibig_group, annual_meeting, paused_codes, tracking_from)
  values (p_business, v_org, coalesce(p_has_employees, false), coalesce(p_withholds, false), p_tax_type, p_philhealth_digit, p_pagibig_group,
          p_annual_meeting, coalesce(p_paused, '{}'), private.today_ph() - 31)
  on conflict (business_id) do update set has_employees = excluded.has_employees, withholds = excluded.withholds, tax_type = excluded.tax_type,
    philhealth_digit = excluded.philhealth_digit, pagibig_group = excluded.pagibig_group, annual_meeting = excluded.annual_meeting,
    paused_codes = excluded.paused_codes, updated_by = auth.uid(), updated_at = now();
end $$;
revoke all on function public.save_filing_setup(uuid, boolean, boolean, text, smallint, text, date, text[]) from public, anon;
grant execute on function public.save_filing_setup(uuid, boolean, boolean, text, smallint, text, date, text[]) to authenticated;

-- Stop tracking taxes for a business. What was already recorded as filed is kept.
create or replace function public.remove_filing_setup(p_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.filing_setup where business_id = p_business and org_id in (select private.my_writable_org_ids())) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.filing_setup where business_id = p_business;
end $$;
revoke all on function public.remove_filing_setup(uuid) from public, anon;
grant execute on function public.remove_filing_setup(uuid) to authenticated;

-- Record that a return or payment was filed (or correct the record).
create or replace function public.mark_filing(p_business uuid, p_code text, p_period date, p_filed_on date,
  p_reference text default null, p_amount numeric default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_bname text; v_t public.filing_types; v_due date; v_id uuid; v_label text;
begin
  select org_id, name into v_org, v_bname from public.businesses where id = p_business and deleted_at is null;
  if v_org is null or v_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_t from public.filing_types where code = p_code;
  if v_t.code is null or p_period is null then raise exception 'Unknown filing.' using errcode = '22023'; end if;
  -- It must be one this business actually has for that period.
  select private.filing_due(v_t.rule, p_period, s.philhealth_digit, coalesce(s.pagibig_group, private.pagibig_group(v_bname)), s.annual_meeting)
    into v_due from public.filing_setup s where s.business_id = p_business;
  if v_due is null or not exists (select 1 from private.filing_obligations(v_org, v_due, v_due) o
                                  where o.business_id = p_business and o.code = p_code and o.period_start = p_period) then raise exception 'That filing is not on this business''s list. Refresh the page.' using errcode = '22023'; end if;
  if p_filed_on is null then raise exception 'Enter the date it was filed.' using errcode = '22023'; end if;
  if p_filed_on > private.today_ph() then raise exception 'The filing date can''t be in the future.' using errcode = '22023'; end if;
  if p_filed_on < p_period then raise exception 'The filing date is before the period it covers. Check the date.' using errcode = '22023'; end if;
  if p_amount is not null and p_amount < 0 then raise exception 'The amount can''t be negative.' using errcode = '22023'; end if;
  insert into public.filing_records as r (org_id, business_id, code, period_start, filed_on, reference, amount, note)
  values (v_org, p_business, p_code, p_period, p_filed_on, nullif(btrim(p_reference), ''), p_amount, nullif(btrim(p_note), ''))
  on conflict (business_id, code, period_start) do update set filed_on = excluded.filed_on, reference = excluded.reference,
    amount = excluded.amount, note = excluded.note, filed_by = auth.uid()
  returning id into v_id;
  v_label := private.filing_period_label(v_t.frequency, v_t.code, p_period);
  insert into public.audit_log (org_id, actor_id, entity, entity_id, action, summary, business_id)
  values (v_org, auth.uid(), 'filing_records', v_id, 'recorded',
    'Filed ' || case when v_t.agency in ('BIR','SEC') then v_t.agency || ' ' || v_t.form else v_t.name end || ' for ' || v_label || ' (' || v_bname || ')'
    || case when p_filed_on > v_due then ', ' || (p_filed_on - v_due) || ' days late' else '' end, p_business);
  return v_id;
end $$;
revoke all on function public.mark_filing(uuid, text, date, date, text, numeric, text) from public, anon;
grant execute on function public.mark_filing(uuid, text, date, date, text, numeric, text) to authenticated;

create or replace function public.unmark_filing(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_r public.filing_records; v_t public.filing_types; v_bname text;
begin
  select * into v_r from public.filing_records where id = p_id;
  if v_r.id is null or v_r.org_id not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_t from public.filing_types where code = v_r.code;
  select name into v_bname from public.businesses where id = v_r.business_id;
  delete from public.filing_records where id = p_id;
  insert into public.audit_log (org_id, actor_id, entity, entity_id, action, summary, business_id)
  values (v_r.org_id, auth.uid(), 'filing_records', p_id, 'removed',
    'Marked ' || case when v_t.agency in ('BIR','SEC') then v_t.agency || ' ' || v_t.form else v_t.name end || ' for ' || private.filing_period_label(v_t.frequency, v_t.code, v_r.period_start)
    || ' as not filed (' || coalesce(v_bname, 'business') || ')', v_r.business_id);
end $$;
revoke all on function public.unmark_filing(uuid) from public, anon;
grant execute on function public.unmark_filing(uuid) to authenticated;

-- ================================================================ reminders
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('overdue','due_soon','help','team','billing','system','assigned','escalation','filing'));

-- Daily: a week before, the day before (and the day itself), then weekly for 8 weeks while not filed.
-- In-app for everyone who can edit; email for the week-before, day-before and first overdue notice.
create or replace function private.queue_filing_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_n int := 0; v record;
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
  return v_n;
end $$;
revoke all on function private.queue_filing_reminders() from public, anon, authenticated;
select cron.schedule('pp-filing-reminders', '10 23 * * *', $$select private.queue_filing_reminders()$$);  -- 7:10am Manila

insert into private.features (name) values ('filings') on conflict do nothing;
