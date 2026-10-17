-- Assigning permits to teammates, who gets reminders, escalation to owners, and handing permits back
-- when someone leaves. Rolled back at the end; every row should say ok = true.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create temp table t_ids (org uuid, biz uuid, mp uuid, fsic uuid); grant all on t_ids to authenticated; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('a0000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@t.ph','{"first_name":"Olive"}', now()),
 ('a0000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ben@t.ph','{"first_name":"Ben"}', now()),
 ('a0000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vic@t.ph','{"first_name":"Vic"}', now()),
 ('a0000000-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','out@t.ph','{"first_name":"Out"}', now());

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Olive Foods');
update t_ids set biz = public.create_business(org, 'Olive Cafe', 'Corporation', 'restaurant', 'Pasig City', '');
update t_ids set mp = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit'),
                 fsic = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'fsic');
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, mp, 'MP-1', private.today_ph() + 5 from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, fsic, 'F-1', private.today_ph() + 5 from t_ids;
reset role;
insert into public.org_members (org_id, user_id, role) select org, 'a0000000-0000-4000-8000-0000000000b2', 'member' from t_ids;
insert into public.org_members (org_id, user_id, role) select org, 'a0000000-0000-4000-8000-0000000000c3', 'viewer' from t_ids;

-- ---------------------------------------------------------------- assigning
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ declare n int; begin
  n := public.assign_requirements(array[(select mp from t_ids)], 'a0000000-0000-4000-8000-0000000000b2');
  perform pg_temp.res('owner assigns the Mayor''s permit to Ben', n = 1, n::text);
  begin perform public.assign_requirements(array[(select fsic from t_ids)], 'a0000000-0000-4000-8000-0000000000c3');
    perform pg_temp.res('a viewer cannot be assigned', false, 'was allowed');
  exception when others then perform pg_temp.res('a viewer cannot be assigned', sqlerrm like '%can only view%', sqlerrm); end;
  begin perform public.assign_requirements(array[(select fsic from t_ids)], 'a0000000-0000-4000-8000-0000000000d4');
    perform pg_temp.res('someone outside the team cannot be assigned', false, 'was allowed');
  exception when others then perform pg_temp.res('someone outside the team cannot be assigned', sqlerrm like '%isn''t on this workspace%', sqlerrm); end;
  begin update public.requirements set assignee_id = 'a0000000-0000-4000-8000-0000000000d4' where id = (select fsic from t_ids);
    perform pg_temp.res('a direct update cannot sneak in an outsider either', false, 'was allowed');
  exception when others then perform pg_temp.res('a direct update cannot sneak in an outsider either', true, sqlerrm); end;
  n := public.assign_requirements(array[(select mp from t_ids)], 'a0000000-0000-4000-8000-0000000000b2');
  perform pg_temp.res('assigning the same person again changes nothing', n = 0, n::text);
  begin perform public.set_escalation((select org from t_ids), 0);
    perform pg_temp.res('escalation days must be 1-60', false, 'was allowed');
  exception when others then perform pg_temp.res('escalation days must be 1-60', true, sqlerrm); end;
  perform public.set_escalation((select org from t_ids), 7);
end $$;
reset role;
select pg_temp.res('Ben is told he is handling it', count(*) = 1, string_agg(title, ' | '))
  from public.notifications where user_id = 'a0000000-0000-4000-8000-0000000000b2' and kind = 'assigned';
select pg_temp.res('status view shows who is handling it', assignee_id = 'a0000000-0000-4000-8000-0000000000b2', coalesce(assignee_id::text, 'none'))
  from public.requirement_status where id = (select mp from t_ids);

-- outsider and viewer cannot assign
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.assign_requirements(array[(select fsic from t_ids)], null);
  perform pg_temp.res('someone from another workspace cannot assign', false, 'was allowed');
exception when others then perform pg_temp.res('someone from another workspace cannot assign', sqlerrm = 'Not allowed.', sqlerrm); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.assign_requirements(array[(select fsic from t_ids)], 'a0000000-0000-4000-8000-0000000000b2');
  perform pg_temp.res('a viewer cannot assign', false, 'was allowed');
exception when others then perform pg_temp.res('a viewer cannot assign', true, sqlerrm); end $$;
reset role;

-- ---------------------------------------------------------------- reminders + escalation
select private.queue_due_reminders();
select pg_temp.res('the handler (Ben) gets the reminder for his permit', count(*) = 1, count(*)::text)
  from public.notifications where user_id = 'a0000000-0000-4000-8000-0000000000b2' and requirement_id = (select mp from t_ids) and kind = 'due_soon';
select pg_temp.res('the owner does not get the routine reminder for Ben''s permit', count(*) = 0, count(*)::text)
  from public.notifications where user_id = 'a0000000-0000-4000-8000-0000000000a1' and requirement_id = (select mp from t_ids) and kind = 'due_soon';
select pg_temp.res('unassigned permits still remind everyone who can edit', count(*) = 2, string_agg(user_id::text, ','))
  from public.notifications where requirement_id = (select fsic from t_ids) and kind = 'due_soon';
select pg_temp.res('the owner is alerted that Ben''s permit isn''t started, 5 days out', count(*) = 1, string_agg(title, ' | '))
  from public.notifications where user_id = 'a0000000-0000-4000-8000-0000000000a1' and kind = 'escalation';
select pg_temp.res('the handler is not escalated to about himself', count(*) = 0, count(*)::text)
  from public.notifications where user_id = 'a0000000-0000-4000-8000-0000000000b2' and kind = 'escalation';
select pg_temp.res('the viewer gets nothing', count(*) = 0, count(*)::text)
  from public.notifications where user_id = 'a0000000-0000-4000-8000-0000000000c3' and kind in ('due_soon', 'escalation');
select private.queue_due_reminders();
select pg_temp.res('running again the same day sends nothing new', count(*) = 1, count(*)::text)
  from public.notifications where user_id = 'a0000000-0000-4000-8000-0000000000a1' and kind = 'escalation';

-- started renewal: no escalation while in progress and not overdue
update public.requirements set renewal_started_at = now() where id = (select mp from t_ids);
delete from public.notifications where kind = 'escalation';
select private.queue_due_reminders();
select pg_temp.res('no escalation once the renewal is started', count(*) = 0, count(*)::text) from public.notifications where kind = 'escalation';
update public.requirements set renewal_started_at = null where id = (select mp from t_ids);
update public.orgs set escalate_days = null where id = (select org from t_ids);
select private.queue_due_reminders();
select pg_temp.res('escalation off: no alert before the due date', count(*) = 0, count(*)::text) from public.notifications where kind = 'escalation';
update public.requirement_cycles set expires_on = private.today_ph() - 2 where requirement_id = (select mp from t_ids);
select private.queue_due_reminders();
select pg_temp.res('overdue is always escalated, even with early alerts off', count(*) = 1, string_agg(title, ' | ')) from public.notifications where kind = 'escalation';

-- ---------------------------------------------------------------- leaving the team
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.remove_member((select org from t_ids), 'a0000000-0000-4000-8000-0000000000b2');
reset role;
select pg_temp.res('when Ben leaves, his permit goes back to nobody', assignee_id is null, coalesce(assignee_id::text, 'nobody'))
  from public.requirements where id = (select mp from t_ids);
select pg_temp.res('the owner is told it has no handler now', count(*) = 1, string_agg(title, ' | '))
  from public.notifications where user_id = 'a0000000-0000-4000-8000-0000000000a1' and kind = 'assigned' and title like '%no longer ha%';
-- becoming a viewer does the same
insert into public.org_members (org_id, user_id, role) select org, 'a0000000-0000-4000-8000-0000000000b2', 'member' from t_ids;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.assign_requirements(array[(select fsic from t_ids)], 'a0000000-0000-4000-8000-0000000000b2');
select public.set_member_role((select org from t_ids), 'a0000000-0000-4000-8000-0000000000b2', 'viewer');
reset role;
select pg_temp.res('made a viewer: their permits go back to nobody', assignee_id is null, coalesce(assignee_id::text, 'nobody'))
  from public.requirements where id = (select fsic from t_ids);
-- deleting a whole workspace with assignments still works
delete from public.orgs where id = (select org from t_ids);
select pg_temp.res('a workspace with assigned permits can still be deleted', not exists (select 1 from public.orgs where id = (select org from t_ids)), '');

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
