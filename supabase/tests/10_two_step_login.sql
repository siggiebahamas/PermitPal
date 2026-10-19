-- Two-step login: a workspace that requires it is closed to sessions that haven't done the second
-- step, owners can't lock themselves out, and staff can reset a lost phone. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create temp table t_ids (org uuid, biz uuid); grant all on t_ids to authenticated; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('e0000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner2@t.ph','{"first_name":"Ona"}', now()),
 ('e0000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mem2@t.ph','{"first_name":"Mel"}', now()),
 ('e0000000-0000-4000-8000-0000000000f3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff2@t.ph','{"first_name":"Sta"}', now());
update public.profiles set is_platform_admin = true where id = 'e0000000-0000-4000-8000-0000000000f3';
insert into auth.mfa_factors (user_id, friendly_name, status) values ('e0000000-0000-4000-8000-0000000000b2', 'Phone', 'verified');

select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Secure Co');
update t_ids set biz = public.create_business(org, 'Secure Store', 'Corporation', 'retail', 'Makati City', '');
do $$ begin perform public.set_require_mfa((select org from t_ids), true);
  perform pg_temp.res('an owner without two-step login cannot require it (no lock-out)', false, 'was allowed');
exception when others then perform pg_temp.res('an owner without two-step login cannot require it (no lock-out)', sqlerrm like '%for yourself first%', sqlerrm); end $$;
reset role;
insert into public.org_members (org_id, user_id, role) select org, 'e0000000-0000-4000-8000-0000000000b2', 'member' from t_ids;

-- the owner, after their second step, turns it on
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.set_require_mfa(org, true) from t_ids;
select pg_temp.res('with two-step login done, the owner still sees everything', (select count(*) from public.businesses) = 1 and (select count(*) from public.requirement_status) > 0, '');
reset role;
select pg_temp.res('the team is told', count(*) = 1, count(*)::text) from public.notifications where user_id = 'e0000000-0000-4000-8000-0000000000b2' and title like '%requires two-step login';

-- the same people with only a password: the workspace is closed
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000b2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select pg_temp.res('password only: the workspace''s data is hidden', (select count(*) from public.businesses) = 0 and (select count(*) from public.requirement_status) = 0
  and (select count(*) from public.orgs) = 0, '');
select pg_temp.res('password only: they can see which workspace needs it, and nothing else', (select string_agg(name, ',') from public.my_locked_orgs()) = 'Secure Co', '');
do $$ begin perform public.create_business((select org from t_ids), 'Sneaky', 'Corporation', 'retail', '', '');
  perform pg_temp.res('password only: nothing can be added either', false, 'was allowed');
exception when others then perform pg_temp.res('password only: nothing can be added either', true, sqlerrm); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000b2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select pg_temp.res('after the second step, the member sees it again', (select count(*) from public.businesses) = 1 and (select count(*) from public.my_locked_orgs()) = 0, '');
do $$ begin perform public.set_require_mfa((select org from t_ids), false);
  perform pg_temp.res('only the owner can switch it off', false, 'was allowed');
exception when others then perform pg_temp.res('only the owner can switch it off', true, sqlerrm); end $$;
reset role;
select pg_temp.res('the daily jobs (no signed-in person) are not affected', (select count(*) from private.filing_obligations(null, private.today_ph(), private.today_ph())) >= 0
  and (select private.queue_due_reminders()) >= 0, '');

-- lost phone
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
do $$ begin perform public.admin_reset_mfa('mem2@t.ph', 'They called from their registered number and showed ID on video');
  perform pg_temp.res('customers cannot reset anyone''s two-step login', false, 'was allowed');
exception when others then perform pg_temp.res('customers cannot reset anyone''s two-step login', sqlerrm = 'Staff only.', sqlerrm); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000f3","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
do $$ begin perform public.admin_reset_mfa('mem2@t.ph', 'ok');
  perform pg_temp.res('staff must say how they confirmed who it is', false, 'was allowed');
exception when others then perform pg_temp.res('staff must say how they confirmed who it is', sqlerrm like '%how you confirmed%', sqlerrm); end $$;
select pg_temp.res('staff can reset after confirming identity', public.admin_reset_mfa(' MEM2@t.ph ', 'Video call, matched government ID to profile') = 1, '');
reset role;
select pg_temp.res('the authenticator is removed', not exists (select 1 from auth.mfa_factors where user_id = 'e0000000-0000-4000-8000-0000000000b2'), '');
select pg_temp.res('the person is told by email and in the app', exists (select 1 from public.notifications where user_id = 'e0000000-0000-4000-8000-0000000000b2' and title like 'Two-step login was turned off%')
  and exists (select 1 from public.message_outbox where channel = 'email' and to_address = 'mem2@t.ph' and subject like '%Two-step login was turned off%'), '');
select pg_temp.res('every reset is logged with the reason', count(*) = 1, count(*)::text) from private.mfa_resets where email = 'mem2@t.ph' and reason like 'Video call%';

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
