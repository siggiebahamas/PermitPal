-- PermitPal is now Pinoy Permit: the database's emails, notices, errors and service text use the new name, web
-- addresses and stored codes keep the old spelling, and nothing else changes. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'pinoypermit'), '');
select pg_temp.res('no database function says PermitPal any more', not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosrc ~ '(^|[^/A-Za-z])PermitPal'),
  (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~ '(^|[^/A-Za-z])PermitPal'));
select pg_temp.res('every email starts with the Pinoy Permit logo', private.email_html('Hi', '<p>x</p>', null, null)
  like '%img/wordmark.png" alt="Pinoy Permit"%', '');
select pg_temp.res('the email footer names Pinoy Permit', private.email_html('Hi', '<p>x</p>', null, null) like '%your Pinoy Permit settings%', '');
select pg_temp.res('service descriptions say Pinoy Permit', not exists (select 1 from public.services where summary ~ 'PermitPal' or name ~ 'PermitPal')
  and exists (select 1 from public.services where summary like '%Pinoy Permit%'), '');
select pg_temp.res('errors say Pinoy Permit', pg_temp.err('select public.file_guarantee_claim(gen_random_uuid(), gen_random_uuid(), 1000, null, ''x'')')
  = 'Pinoy Permit doesn''t pay late penalties or surcharges.', '');
select pg_temp.res('the site address keeps its /PermitPal/ path', private.setting('app_url') = 'https://siggiebahamas.github.io/PermitPal/', private.setting('app_url'));
select pg_temp.res('bills paid for you keep their stored code', pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.gov_bills'::regclass
  and pg_get_constraintdef(oid) like '%permitpal%' limit 1)) like '%''permitpal''%', '');

select n, step, ok, info from t_res order by n;
rollback;
