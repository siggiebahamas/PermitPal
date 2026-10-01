-- Reminders, help requests, invites, roles and billing guards.
-- Always ends in an exception so nothing is kept; read PASS/FAIL from the message.

create temp table t_results (n serial, step text, ok boolean, detail text) on commit drop;
grant insert, select on t_results to authenticated;
grant usage on sequence t_results_n_seq to authenticated;
create temp table t_ids (org uuid, biz uuid, req uuid, help uuid, token text) on commit drop;
grant all on t_ids to authenticated;
insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at) values
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@test.local','{"first_name":"Olive"}', now(), now(), now()),
  ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@test.local','{"first_name":"Staff"}', now(), now(), now()),
  ('55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mate@test.local','{"first_name":"Mate"}', now(), now(), now());
update public.profiles set is_platform_admin = true where id = '44444444-4444-4444-4444-444444444444';

-- ---------------------------------------------------------------- owner sets up data
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Olive Foods');
update t_ids set biz = public.create_business(org, 'Olive Cafe', 'Corporation', 'restaurant', 'Pasig City', '');
update t_ids set req = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit');
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
  select org, req, 'MP-9', private.today_ph() + 5 from t_ids;
reset role;

-- ---------------------------------------------------------------- the reminder job (runs as the system)
select private.queue_due_reminders();
insert into t_results (step, ok, detail) select 'reminder notification created (7-day stage)', count(*) = 1, string_agg(title || ' / ' || dedupe_key, '; ')
  from public.notifications where user_id = '33333333-3333-3333-3333-333333333333' and kind = 'due_soon';
insert into t_results (step, ok, detail) select 'one reminder email queued', count(*) = 1, string_agg(subject, '; ')
  from public.message_outbox where user_id = '33333333-3333-3333-3333-333333333333' and dedupe_key like 'remmail:%';
insert into t_results (step, ok, detail) select 'no SMS on Free plan', count(*) = 0, count(*)::text
  from public.message_outbox where user_id = '33333333-3333-3333-3333-333333333333' and channel = 'sms';
select private.queue_due_reminders();
insert into t_results (step, ok, detail) select 'running the job twice does not duplicate', count(*) = 1, count(*)::text
  from public.notifications where user_id = '33333333-3333-3333-3333-333333333333' and kind = 'due_soon';

-- ---------------------------------------------------------------- help request from the owner
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
insert into public.assistance_requests (org_id, requirement_id, docs_status, contact_method, contact_value, notes, requirement_name, subject_label, status)
  select org, req, 'have', 'whatsapp', '+639171234567', 'Please handle it', 'x', 'x', 'submitted' from t_ids;
update t_ids set help = (select id from public.assistance_requests where requirement_id = (select req from t_ids));
insert into t_results (step, ok, detail) select 'help request snapshots the real names', requirement_name = 'Mayor''s / Business Permit' and subject_label = 'Olive Cafe',
  requirement_name || ' / ' || subject_label from public.assistance_requests where id = (select help from t_ids);
insert into t_results (step, ok, detail) select 'open help request = in_progress', status = 'in_progress', status
  from public.requirement_status where id = (select req from t_ids);
do $$ begin
  update public.assistance_requests set status = 'completed', quote_php = 1 where id = (select help from t_ids);
  insert into t_results (step, ok, detail) values ('customer cannot mark own request completed', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('customer cannot mark own request completed', true, sqlerrm);
end $$;
reset role;
insert into t_results (step, ok, detail) select 'staff alerted in-app', count(*) = 1, count(*)::text
  from public.notifications where user_id = '44444444-4444-4444-4444-444444444444' and kind = 'help';
insert into t_results (step, ok, detail) select 'founder email queued', count(*) >= 1, string_agg(to_address, ',')
  from public.message_outbox where dedupe_key like 'ordernew:%';

-- ---------------------------------------------------------------- staff handles it
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
insert into t_results (step, ok, detail) select 'staff can see the request', count(*) = 1, count(*)::text from public.assistance_requests where id = (select help from t_ids);
insert into t_results (step, ok, detail) select 'staff can see the requirement while request is open', count(*) = 1, count(*)::text from public.requirements where id = (select req from t_ids);
insert into t_results (step, ok, detail) select 'staff cannot see other businesses', count(*) = 0, count(*)::text from public.businesses;
update public.assistance_requests set status = 'provider_contacted', quote_php = 2500, admin_note = 'Agent visits Pasig BPLO Monday' where id = (select help from t_ids);
reset role;
insert into t_results (step, ok, detail) select 'customer notified of update', count(*) >= 1, string_agg(title, '; ')
  from public.notifications where user_id = '33333333-3333-3333-3333-333333333333' and title like '%Provider contacted%';

-- ---------------------------------------------------------------- invites & roles
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  insert into public.org_invites (org_id, email, role) select org, 'mate@test.local', 'member' from t_ids;
  insert into t_results (step, ok, detail) values ('Free plan blocks invites (1 seat)', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('Free plan blocks invites (1 seat)', sqlerrm like 'Your plan includes 1 team member%', sqlerrm);
end $$;
reset role;
update public.orgs set plan_id = 'business' where id = (select org from t_ids);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
insert into public.org_invites (org_id, email, role) select org, 'MATE@test.local', 'viewer' from t_ids;
update t_ids set token = (select token from public.org_invites where org_id = (select org from t_ids));
insert into t_results (step, ok, detail) select 'invite email queued', count(*) = 1, count(*)::text from t_ids where token is not null;
reset role;
insert into t_results (step, ok, detail) select 'invite email in outbox', count(*) = 1, string_agg(to_address, ',') from public.message_outbox where dedupe_key like 'invite:%';

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
insert into t_results (step, ok, detail) select 'invite preview works', (public.invite_preview(token)->>'org_name') = 'Olive Foods', public.invite_preview(token)::text from t_ids;
select public.accept_invite(token) from t_ids;
insert into t_results (step, ok, detail) select 'invitee joined as viewer', role = 'viewer', role from public.org_members
  where user_id = '55555555-5555-5555-5555-555555555555';
insert into t_results (step, ok, detail) select 'viewer can read the business', count(*) = 1, count(*)::text from public.businesses;
do $$ begin
  update public.businesses set name = 'Hacked' where id = (select biz from t_ids);
  insert into t_results (step, ok, detail) select 'viewer cannot edit', name <> 'Hacked', name from public.businesses where id = (select biz from t_ids);
exception when others then
  insert into t_results (step, ok, detail) values ('viewer cannot edit', true, sqlerrm);
end $$;
do $$ begin
  perform public.remove_member((select org from t_ids), '33333333-3333-3333-3333-333333333333');
  insert into t_results (step, ok, detail) values ('viewer cannot remove the owner', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('viewer cannot remove the owner', true, sqlerrm);
end $$;
do $$ begin
  perform public.billing_start((select org from t_ids), 'business', 1);
  insert into t_results (step, ok, detail) values ('only owner can start checkout', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('only owner can start checkout', true, sqlerrm);
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.remove_member((select org from t_ids), '33333333-3333-3333-3333-333333333333');
  insert into t_results (step, ok, detail) values ('last owner cannot leave', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('last owner cannot leave', sqlerrm like 'A workspace needs at least one owner%', sqlerrm);
end $$;
do $$ begin
  perform public.billing_start((select org from t_ids), 'business', 1);
  insert into t_results (step, ok, detail) values ('checkout refused while price not set', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('checkout refused while price not set', sqlerrm like '%not available for online payment%', sqlerrm);
end $$;
insert into t_results (step, ok, detail) select 'History includes team + help events', count(*) >= 3, string_agg(summary, ' | ' order by id)
  from public.audit_log where org_id = (select org from t_ids) and entity in ('org_members','assistance_requests');
reset role;

do $$
declare v text;
begin
  select string_agg(case when ok then 'PASS ' else 'FAIL ' end || step || case when ok then '' else ' -> ' || coalesce(detail, '') end, E'\n' order by n)
    into v from t_results;
  raise exception E'TEST RESULTS (rolled back)\n%', v;
end $$;
