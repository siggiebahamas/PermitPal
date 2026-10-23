-- Payment QR code: staff can save a small image, customers can read it, nobody else can change it, and only images
-- are accepted. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to authenticated, anon;
create function pg_temp.as_user(u text) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $f$;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('ec000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@qr.ph','{"first_name":"Rosa"}', now()),
 ('ec000000-0000-4000-8000-0000000000f5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@qr.ph','{"first_name":"Faye"}', now());
update public.profiles set is_platform_admin = true where id = 'ec000000-0000-4000-8000-0000000000f5';

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'payqr'), '');
select pg_temp.res('there is an empty payment_qr setting', (select value from public.app_settings where key = 'payment_qr') = '', '');

set local role authenticated;
select pg_temp.as_user('ec000000-0000-4000-8000-0000000000f5');
create temp table t_save as select pg_temp.err($q$update public.app_settings set value = 'data:image/png;base64,' || repeat('QUJD', 5000) where key = 'payment_qr'$q$) r;
select pg_temp.res('staff save a QR image', (select r from t_save) = 'allowed' and (select length(value) from public.app_settings where key = 'payment_qr') > 500, (select r from t_save));
select pg_temp.res('anything that is not an image is refused', pg_temp.err($q$update public.app_settings set value = 'javascript:alert(1)' where key = 'payment_qr'$q$) like '%app_settings_value_check%', '');
select pg_temp.res('an SVG is refused (it could carry a script)', pg_temp.err($q$update public.app_settings set value = 'data:image/svg+xml;base64,PHN2Zz4=' where key = 'payment_qr'$q$) like '%app_settings_value_check%', '');
select pg_temp.res('a huge image is refused', pg_temp.err($q$update public.app_settings set value = 'data:image/png;base64,' || repeat('QUJD', 40000) where key = 'payment_qr'$q$) like '%app_settings_value_check%', '');
select pg_temp.res('other settings still stop at 500 characters', pg_temp.err($q$update public.app_settings set value = repeat('x', 501) where key = 'payment_note'$q$) like '%app_settings_value_check%', '');
select pg_temp.res('staff can remove the QR', pg_temp.err($q$update public.app_settings set value = '' where key = 'payment_qr'$q$) = 'allowed', '');
select pg_temp.err($q$update public.app_settings set value = 'data:image/png;base64,QUJD' where key = 'payment_qr'$q$);

select pg_temp.as_user('ec000000-0000-4000-8000-0000000000a1');
select pg_temp.res('a customer can read the QR to pay', (select value from public.app_settings where key = 'payment_qr') = 'data:image/png;base64,QUJD', '');
select pg_temp.err($q$update public.app_settings set value = '' where key = 'payment_qr'$q$);
select pg_temp.res('a customer cannot change it', (select value from public.app_settings where key = 'payment_qr') = 'data:image/png;base64,QUJD', '');
reset role;
set local role anon;
select pg_temp.res('visitors who are not signed in cannot read it', pg_temp.err('select value from public.app_settings where key = ''payment_qr''') like 'permission denied%', '');
reset role;

select n, step, ok, info from t_res order by n;
rollback;
