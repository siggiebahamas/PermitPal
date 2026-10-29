-- Database file 21: site themes saved with each profile. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated; grant all on sequence t_res_n_seq to authenticated;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to authenticated;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('f0000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','theme@x.ph','{"first_name":"Tess"}', now());
select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'themes'), '');
select pg_temp.res('everyone starts on Signature', (select theme from public.profiles where id = 'f0000000-0000-4000-8000-0000000000a1') = 'signature', '');
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('a person can pick Mint garden for themselves', pg_temp.err($q$update public.profiles set theme = 'mint' where id = 'f0000000-0000-4000-8000-0000000000a1'$q$) = 'allowed', '');
select pg_temp.res('only the five themes are allowed', pg_temp.err($q$update public.profiles set theme = 'neon' where id = 'f0000000-0000-4000-8000-0000000000a1'$q$) like '%check%', '');
reset role;
select pg_temp.res('it is saved', (select theme from public.profiles where id = 'f0000000-0000-4000-8000-0000000000a1') = 'mint', '');
select n, step, ok, info from t_res order by n;
rollback;
