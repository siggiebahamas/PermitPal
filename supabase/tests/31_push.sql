-- Database file 22: phone alerts. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, service_role; grant all on sequence t_res_n_seq to authenticated, service_role;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, service_role;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to authenticated, service_role;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('f0000000-0000-4000-8000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','push1@x.ph','{"first_name":"Pia"}', now()),
 ('f0000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','push2@x.ph','{"first_name":"Pol"}', now());

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'push'), '');
select pg_temp.res('old notifications never go to phones', not exists (select 1 from public.notifications where pushed_at is null), '');
select pg_temp.res('a check runs every 5 minutes', exists (select 1 from cron.job where jobname = 'pp-flush-push'), '');
select pg_temp.res('no keys yet: anyone can ask, the answer is empty', public.push_public_key() is null, '');

-- Pia turns on reminders
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('a test alert needs reminders turned on first', pg_temp.err($q$select public.push_test()$q$) like '%Turn on reminders%', '');
select pg_temp.res('Pia turns on reminders on her phone', pg_temp.err($q$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/abc123def456',
  'BPx' || repeat('A', 84), repeat('b', 22), 'Android phone')$q$) = 'allowed', '');
select pg_temp.res('a bad address is refused', pg_temp.err($q$select public.push_subscribe('http://evil', 'x', 'y')$q$) <> 'allowed', '');
select pg_temp.res('she sees her own phone only', (select count(*) from public.push_subscriptions) = 1, '');
select pg_temp.res('the app cannot write the table directly', pg_temp.err($q$delete from public.push_subscriptions$q$) <> 'allowed'
  or (select count(*) from public.push_subscriptions) = 1, '');
select pg_temp.res('the sender''s functions are closed to the app', pg_temp.err($q$select public.push_claim('x')$q$) like '%permission%', '');
select pg_temp.res('a test alert is a normal notification', pg_temp.err($q$select public.push_test()$q$) = 'allowed', '');
reset role;
select pg_temp.res('the test woke the sender', exists (select 1 from net.calls where url like '%/send-messages' and body ->> 'push' = 'true'), '');

-- two more for Pia, one for Pol (no phone)
insert into public.notifications (user_id, kind, title, body, link) values
 ('f0000000-0000-4000-8000-0000000000b1', 'overdue', 'Mayor''s Permit is overdue', 'Main store', '#/requirement/x'),
 ('f0000000-0000-4000-8000-0000000000b1', 'due_soon', 'Fire safety in 7 days', 'Main store', '#/requirement/y'),
 ('f0000000-0000-4000-8000-0000000000b2', 'due_soon', 'CTPL in 7 days', 'ABC 1234', '#/requirement/z');

set local role service_role;
select pg_temp.res('a wrong secret is refused', pg_temp.err($q$select public.push_claim('wrong')$q$) like '%unauthorized%', '');
select pg_temp.res('the keys are saved once', public.push_set_keys(private.setting('cron_secret'), repeat('K', 87), '{"kty":"EC","d":"secret"}') = repeat('K', 87), '');
select pg_temp.res('and never replaced', public.push_set_keys(private.setting('cron_secret'), repeat('Z', 87), '{"kty":"EC","d":"other"}') = repeat('K', 87), '');
create temp table t_claim as select public.push_claim(private.setting('cron_secret')) as v;
reset role;
select pg_temp.res('one alert for Pia, grouping her three notifications', jsonb_array_length((select v -> 'alerts' from t_claim)) = 1
  and (select v -> 'alerts' -> 0 ->> 'title' from t_claim) = '3 things need you', (select (v -> 'alerts')::text from t_claim));
select pg_temp.res('the most urgent leads the alert', (select v -> 'alerts' -> 0 ->> 'body' from t_claim) like 'Mayor''s Permit is overdue, and 2 more', '');
select pg_temp.res('it carries her phone and the keys', jsonb_array_length((select v -> 'alerts' -> 0 -> 'subs' from t_claim)) = 1
  and (select v ->> 'public' from t_claim) = repeat('K', 87) and (select v ->> 'private' from t_claim) like '%secret%', '');
select pg_temp.res('nothing is left waiting, Pol included', not exists (select 1 from public.notifications where pushed_at is null), '');
set local role service_role;
select pg_temp.res('a second run finds nothing new', jsonb_array_length(public.push_claim(private.setting('cron_secret')) -> 'alerts') = 0, '');
reset role;

-- the daily limit: 4 alerts a day
insert into public.push_sends (user_id) select 'f0000000-0000-4000-8000-0000000000b1' from generate_series(1, 3);
insert into public.notifications (user_id, kind, title) values ('f0000000-0000-4000-8000-0000000000b1', 'team', 'Ana asked to open files');
set local role service_role;
select pg_temp.res('a 5th alert in one day waits (it stays in the app and email)', jsonb_array_length(public.push_claim(private.setting('cron_secret')) -> 'alerts') = 0, '');
-- a phone that's gone is forgotten
select public.push_result(private.setting('cron_secret'), (select id from public.push_subscriptions limit 1), false, true);
reset role;
select pg_temp.res('a phone that is gone is forgotten', not exists (select 1 from public.push_subscriptions), '');

select n, step, ok, info from t_res order by n;
rollback;
