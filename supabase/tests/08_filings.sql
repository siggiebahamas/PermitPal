-- Government filing deadlines: which filings apply, their due dates, marking them filed, who may do
-- what, and the reminders. Rolled back at the end; every row should say ok = true.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create temp table t_ids (org uuid, corp uuid, sole uuid, rec uuid); grant all on t_ids to authenticated; insert into t_ids default values;

-- ---------------------------------------------------------------- the rules on known dates
select pg_temp.res('withholding on pay: 10th of next month, Jan 15 for December',
  private.filing_due('next10_dec15', '2026-09-01', null, null, null) = '2026-10-10' and private.filing_due('next10_dec15', '2026-12-01', null, null, null) = '2027-01-15', '');
select pg_temp.res('quarterly VAT / percentage tax: 25th day after the quarter', private.filing_due('q_25', '2026-07-01', null, null, null) = '2026-10-25', '');
select pg_temp.res('1601-EQ: last day of the month after the quarter', private.filing_due('q_next_last', '2026-10-01', null, null, null) = '2027-01-31', '');
select pg_temp.res('1701Q: May 15, Aug 15, Nov 15', private.filing_due('q_1701', '2026-01-01', null, null, null) = '2026-05-15'
  and private.filing_due('q_1701', '2026-04-01', null, null, null) = '2026-08-15' and private.filing_due('q_1701', '2026-07-01', null, null, null) = '2026-11-15', '');
select pg_temp.res('1702Q: 60 days after the quarter', private.filing_due('q_60', '2026-01-01', null, null, null) = '2026-05-30', '');
select pg_temp.res('SSS: end of the next month (February is short)', private.filing_due('m_sss', '2026-01-01', null, null, null) = '2026-02-28', '');
select pg_temp.res('PhilHealth: 15th for PEN ending 0-4 or unknown, 20th for 5-9',
  private.filing_due('m_philhealth', '2026-09-01', 3::smallint, null, null) = '2026-10-15' and private.filing_due('m_philhealth', '2026-09-01', 9::smallint, null, null) = '2026-10-20'
  and private.filing_due('m_philhealth', '2026-09-01', null, null, null) = '2026-10-15', '');
select pg_temp.res('Pag-IBIG: by name group', private.filing_due('m_pagibig', '2026-09-01', null, 'A-D', null) = '2026-10-14'
  and private.filing_due('m_pagibig', '2026-09-01', null, 'M-Q', null) = '2026-10-24' and private.filing_due('m_pagibig', '2026-09-01', null, 'R-Z', null) = '2026-10-31', '');
select pg_temp.res('Pag-IBIG group from the name (numbers go last)', private.pagibig_group('Corner Bakery') = 'A-D' and private.pagibig_group('7-Eleven') = 'R-Z'
  and private.pagibig_group(' "Lola" Foods') = 'E-L', '');
select pg_temp.res('GIS: 30 days after the meeting; Feb 29 meetings work in other years',
  private.filing_due('gis', '2026-01-01', null, null, '2024-05-15') = '2026-06-14' and private.filing_due('gis', '2027-01-01', null, null, '2024-02-29') = '2027-03-30', '');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('c0000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','own@t.ph','{"first_name":"Ana"}', now()),
 ('c0000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','view@t.ph','{"first_name":"Vi"}', now()),
 ('c0000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','out@t.ph','{"first_name":"Out"}', now());

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Ana Holdings');
update t_ids set corp = public.create_business(org, 'Mabuhay Trading Corp', 'Corporation', 'retail', 'Pasig City', ''),
                 sole = public.create_business(org, 'Ana Sari-Sari', 'Sole Proprietorship', 'retail', 'Pasig City', '');
-- the corporation: employees, VAT, withholds on rent, annual meeting in May
select public.save_filing_setup(corp, true, true, 'vat', 7::smallint, null, '2020-05-15', '{}') from t_ids;
-- the sole proprietor: no employees, hasn't said which business tax yet
select public.save_filing_setup(sole, false, false, 'unsure') from t_ids;
reset role;
select pg_temp.res('tracking starts a month before setup, so recent ones can be ticked off', tracking_from = private.today_ph() - 31, tracking_from::text)
  from public.filing_setup where business_id = (select corp from t_ids);

-- ---------------------------------------------------------------- which filings apply (a whole year of them)
create temp table t_cal as select * from private.filing_obligations((select org from t_ids), private.today_ph(), private.today_ph() + 365);
grant select on t_cal to authenticated;
select pg_temp.res('the corporation gets payroll, VAT, withholding, income tax and SEC filings',
  (select array_agg(distinct code order by code) from t_cal where business_id = (select corp from t_ids))
   = array['bir_0619e','bir_1601c','bir_1601eq','bir_1604c','bir_1604e','bir_1702','bir_1702q','bir_2550q','pagibig_contrib','philhealth_contrib','sec_afs','sec_gis','sss_contrib'],
  (select string_agg(distinct code, ',') from t_cal where business_id = (select corp from t_ids)));
select pg_temp.res('a year has 12 monthly payroll filings each, 4 VAT returns, 3 quarterly income tax',
  (select count(*) from t_cal where business_id = (select corp from t_ids) and code = 'sss_contrib') = 12
  and (select count(*) from t_cal where business_id = (select corp from t_ids) and code = 'bir_2550q') = 4
  and (select count(*) from t_cal where business_id = (select corp from t_ids) and code = 'bir_1702q') = 3
  and (select count(*) from t_cal where business_id = (select corp from t_ids) and code = 'bir_0619e') = 8, '');
select pg_temp.res('PEN ending 7: PhilHealth on the 20th', bool_and(extract(day from due_on) = 20), '')
  from t_cal where business_id = (select corp from t_ids) and code = 'philhealth_contrib';
select pg_temp.res('"Mabuhay": Pag-IBIG by the 24th', bool_and(extract(day from due_on) = 24), '')
  from t_cal where business_id = (select corp from t_ids) and code = 'pagibig_contrib';
select pg_temp.res('the sole proprietor gets only quarterly and yearly income tax until they answer the business tax question',
  (select array_agg(distinct code order by code) from t_cal where business_id = (select sole from t_ids)) = array['bir_1701','bir_1701q'],
  (select string_agg(distinct code, ',') from t_cal where business_id = (select sole from t_ids)));

-- ---------------------------------------------------------------- the calendar, marking filed, and who may do it
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ declare v_period date; v_due date; v_id uuid; begin
  select period_start, due_on into v_period, v_due from public.filing_calendar((select org from t_ids), private.today_ph() - 31, private.today_ph() + 60)
    where business_id = (select corp from t_ids) and code = 'sss_contrib' order by due_on limit 1;
  perform pg_temp.res('the calendar lists SSS', v_period is not null, coalesce(v_period::text, 'none'));
  begin perform public.mark_filing((select corp from t_ids), 'sss_contrib', v_period, private.today_ph() + 1);
    perform pg_temp.res('a filing date in the future is refused', false, 'was allowed');
  exception when others then perform pg_temp.res('a filing date in the future is refused', sqlerrm like '%future%', sqlerrm); end;
  begin perform public.mark_filing((select corp from t_ids), 'sss_contrib', v_period, v_period - 1);
    perform pg_temp.res('a filing date before the period is refused', false, 'was allowed');
  exception when others then perform pg_temp.res('a filing date before the period is refused', sqlerrm like '%before the period%', sqlerrm); end;
  begin perform public.mark_filing((select corp from t_ids), 'sss_contrib', v_period + 3, private.today_ph());
    perform pg_temp.res('a period that isn''t a real filing period is refused', false, 'was allowed');
  exception when others then perform pg_temp.res('a period that isn''t a real filing period is refused', true, sqlerrm); end;
  begin perform public.mark_filing((select corp from t_ids), 'bir_2551q', '2026-07-01', private.today_ph());
    perform pg_temp.res('a filing that doesn''t apply (percentage tax for a VAT business) is refused', false, 'was allowed');
  exception when others then perform pg_temp.res('a filing that doesn''t apply (percentage tax for a VAT business) is refused', sqlerrm like '%not on this business%', sqlerrm); end;
  begin perform public.mark_filing((select corp from t_ids), 'sss_contrib', v_period, private.today_ph(), 'PRN-1', -5);
    perform pg_temp.res('a negative amount is refused', false, 'was allowed');
  exception when others then perform pg_temp.res('a negative amount is refused', true, sqlerrm); end;
  v_id := public.mark_filing((select corp from t_ids), 'sss_contrib', v_period, private.today_ph(), ' PRN-123 ', 4250.50, 'Paid via bank');
  update t_ids set rec = v_id;
  -- correcting it keeps one record
  perform public.mark_filing((select corp from t_ids), 'sss_contrib', v_period, private.today_ph(), 'PRN-124', 4250.50);
  perform pg_temp.res('correcting a record keeps just one', (select count(*) from public.filing_records where business_id = (select corp from t_ids)) = 1
    and (select reference from public.filing_records where id = v_id) = 'PRN-124', '');
  perform pg_temp.res('the calendar shows it as filed', (select filed_on from public.filing_calendar((select org from t_ids), private.today_ph() - 31, private.today_ph() + 60)
    where business_id = (select corp from t_ids) and code = 'sss_contrib' and period_start = v_period) = private.today_ph(), '');
  perform pg_temp.res('History says what was filed, and if it was late',
    exists (select 1 from public.audit_log where entity = 'filing_records' and summary like 'Filed SSS contributions for %(Mabuhay Trading Corp)%'
      and (v_due >= private.today_ph() or summary like '%days late%')), '');
  begin perform public.filing_calendar((select org from t_ids), private.today_ph(), private.today_ph() + 2000);
    perform pg_temp.res('a huge date range is refused', false, 'was allowed');
  exception when others then perform pg_temp.res('a huge date range is refused', true, sqlerrm); end;
end $$;
reset role;
insert into public.org_members (org_id, user_id, role) select org, 'c0000000-0000-4000-8000-0000000000b2', 'viewer' from t_ids;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('a viewer can see the calendar and records', (select count(*) from public.filing_calendar((select org from t_ids), private.today_ph() - 31, private.today_ph() + 60)) > 0
  and (select count(*) from public.filing_records) = 1, '');
do $$ begin perform public.unmark_filing((select rec from t_ids));
  perform pg_temp.res('a viewer cannot change records', false, 'was allowed');
exception when others then perform pg_temp.res('a viewer cannot change records', sqlerrm = 'Not allowed.', sqlerrm); end $$;
do $$ begin perform public.save_filing_setup((select corp from t_ids), false, false, 'percentage');
  perform pg_temp.res('a viewer cannot change the answers', false, 'was allowed');
exception when others then perform pg_temp.res('a viewer cannot change the answers', sqlerrm = 'Not allowed.', sqlerrm); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.filing_calendar((select org from t_ids), private.today_ph(), private.today_ph() + 30);
  perform pg_temp.res('another workspace cannot read the calendar', false, 'was allowed');
exception when others then perform pg_temp.res('another workspace cannot read the calendar', sqlerrm = 'Not allowed.', sqlerrm); end $$;
select pg_temp.res('another workspace sees no setup or records', (select count(*) from public.filing_setup) = 0 and (select count(*) from public.filing_records) = 0, '');
do $$ begin perform public.mark_filing((select corp from t_ids), 'sss_contrib', date_trunc('month', private.today_ph())::date, private.today_ph());
  perform pg_temp.res('another workspace cannot mark filings', false, 'was allowed');
exception when others then perform pg_temp.res('another workspace cannot mark filings', sqlerrm = 'Not allowed.', sqlerrm); end $$;
do $$ begin insert into public.filing_records (org_id, business_id, code, period_start, filed_on) select org, corp, 'sss_contrib', '2026-01-01', '2026-02-01' from t_ids;
  perform pg_temp.res('records can only be written through the functions', false, 'insert allowed');
exception when others then perform pg_temp.res('records can only be written through the functions', true, sqlerrm); end $$;
reset role;

-- ---------------------------------------------------------------- reminders
select private.queue_filing_reminders();
select pg_temp.res('reminders go out for unfiled filings due soon or recently overdue', count(*) > 0, count(*)::text)
  from public.notifications where kind = 'filing' and user_id = 'c0000000-0000-4000-8000-0000000000a1';
select pg_temp.res('nothing is sent for a filing already marked filed', not exists (
  select 1 from public.notifications n, public.filing_records r where n.kind = 'filing' and r.id = (select rec from t_ids)
    and n.dedupe_key like 'fil:' || r.business_id || ':sss_contrib:' || r.period_start || ':%'), '');
select pg_temp.res('viewers get no filing reminders', not exists (select 1 from public.notifications where kind = 'filing' and user_id = 'c0000000-0000-4000-8000-0000000000b2'), '');
select pg_temp.res('running again the same day sends nothing new', (select private.queue_filing_reminders()) >= 0
  and (select count(*) from public.notifications where kind = 'filing') = (select count(distinct dedupe_key) from public.notifications where kind = 'filing'), '');
-- "this doesn't apply to us" stops a filing
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.save_filing_setup(corp, true, true, 'vat', 7::smallint, null, '2020-05-15', array['sec_gis']) from t_ids;
select pg_temp.res('a filing marked "doesn''t apply" leaves the calendar', not exists (select 1 from public.filing_calendar((select org from t_ids), private.today_ph(), private.today_ph() + 365)
  where code = 'sec_gis'), '');
select public.remove_filing_setup(sole) from t_ids;
select pg_temp.res('stopping tracking for a business removes its filings', not exists (select 1 from public.filing_calendar((select org from t_ids), private.today_ph(), private.today_ph() + 365)
  where business_id = (select sole from t_ids)), '');
reset role;
update public.businesses set deleted_at = now() where id = (select corp from t_ids);
select pg_temp.res('a deleted business stops getting filings', not exists (select 1 from private.filing_obligations((select org from t_ids), private.today_ph(), private.today_ph() + 365)), '');

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
