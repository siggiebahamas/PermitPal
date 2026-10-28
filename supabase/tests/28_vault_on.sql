-- Database file 19: the document vault is switched on, and the app sees it. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
select pg_temp.res('the vault switch is on', exists (select 1 from private.features where name = 'vault'), '');
select pg_temp.res('the app sees it (app_features)', (public.app_features() ->> 'vault')::boolean, public.app_features()::text);
select pg_temp.res('files stay private: no one can read the documents bucket without the database rules', (select not public from storage.buckets where id = 'documents'), '');
select n, step, ok, info from t_res order by n;
rollback;
