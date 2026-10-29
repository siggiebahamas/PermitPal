-- Database file 20: "Ask me first" for opening files, and the record of who opened what. Rolled back at the end.
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
create temp table t_ids (org uuid, biz uuid, req uuid, path text, other text, g uuid);
grant all on t_ids to authenticated, anon; insert into t_ids default values;
create function pg_temp.sees(p text) returns boolean language sql as $f$ select exists (select 1 from storage.objects where bucket_id = 'documents' and name = p) $f$;
grant execute on function pg_temp.sees(text) to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('ef000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@files.ph','{"first_name":"Olive"}', now()),
 ('ef000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@files.ph','{"first_name":"Ben"}', now());
select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'fileguard'), '');

set local pp.skip_limits = 'on';
select pg_temp.as_user('ef000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set org = public.create_org('Olive Foods');
update t_ids set biz = public.create_business(org, 'Olive Kitchen', 'Corporation', 'restaurant', 'Quezon City', '1 Main St');
update t_ids set req = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit' limit 1);
reset role;
set local pp.skip_limits = 'off';
insert into public.org_members (org_id, user_id, role) select org, 'ef000000-0000-4000-8000-0000000000b2', 'member' from t_ids;
update t_ids set path = org || '/' || req || '/abc-permit.pdf', other = org || '/bills/x/bill.jpg';
insert into public.documents (org_id, requirement_id, storage_path, file_name, mime_type, size_bytes) select org, req, path, 'permit.pdf', 'application/pdf', 100 from t_ids;
insert into storage.objects (bucket_id, name) select 'documents', path from t_ids union all select 'documents', other from t_ids;

-- open by default
select pg_temp.as_user('ef000000-0000-4000-8000-0000000000b2'); set local role authenticated;
select pg_temp.res('by default the whole team can open files', pg_temp.sees((select path from t_ids)), '');
select pg_temp.res('only the owner can switch on "Ask me first"', pg_temp.err(format($q$select public.set_file_mode(%L, 'ask', true)$q$, (select org from t_ids))) like '%Only the workspace owner%', '');
reset role;
select pg_temp.as_user('ef000000-0000-4000-8000-0000000000a1'); set local role authenticated;
select pg_temp.res('the owner switches it on', pg_temp.err(format($q$select public.set_file_mode(%L, 'ask', true)$q$, (select org from t_ids))) = 'allowed', '');
select pg_temp.res('the owner still opens everything', pg_temp.sees((select path from t_ids)), '');
reset role;

select pg_temp.as_user('ef000000-0000-4000-8000-0000000000b2'); set local role authenticated;
select pg_temp.res('a teammate can no longer open the permit''s file, even straight from storage', not pg_temp.sees((select path from t_ids)), '');
select pg_temp.res('...but still sees bills and other workspace files', pg_temp.sees((select other from t_ids)), '');
select public.log_file_open((select path from t_ids));
update t_ids set g = public.request_file_access((select req from t_ids), 'For the BPLO visit tomorrow');
select pg_temp.res('asking twice keeps one request', public.request_file_access((select req from t_ids)) = (select g from t_ids), '');
select pg_temp.res('a teammate can''t approve their own request', pg_temp.err(format($q$select public.decide_file_access(%L, true)$q$, (select g from t_ids))) like '%Only the owner or an admin%', '');
select pg_temp.res('a teammate can''t read the record of opens', (select count(*) from public.file_opens) = 0, '');
reset role;
select pg_temp.res('nothing was recorded while the file was locked', (select count(*) from public.file_opens where org_id = (select org from t_ids)) = 0, '');
select pg_temp.res('the owner is told about the request', exists (select 1 from public.notifications where user_id = 'ef000000-0000-4000-8000-0000000000a1' and title like 'Ben asked to open the files of%'), '');

select pg_temp.as_user('ef000000-0000-4000-8000-0000000000a1'); set local role authenticated;
select pg_temp.res('the owner sees the request with the note', (public.file_access_state((select org from t_ids)) -> 'pending' -> 0 ->> 'note') = 'For the BPLO visit tomorrow', '');
select public.decide_file_access((select g from t_ids), true, 24);
select pg_temp.res('it can''t be answered twice', pg_temp.err(format($q$select public.decide_file_access(%L, false)$q$, (select g from t_ids))) like '%already answered%', '');
reset role;

select pg_temp.as_user('ef000000-0000-4000-8000-0000000000b2'); set local role authenticated;
select pg_temp.res('allowed: the teammate can open it, for 24 hours', pg_temp.sees((select path from t_ids))
  and (public.file_access_state((select org from t_ids)) -> 'mine' -> 0 ->> 'status') = 'approved', '');
select public.log_file_open((select path from t_ids));
reset role;
select pg_temp.res('the open is recorded, and the owner is told (alerts on)', (select count(*) from public.file_opens where org_id = (select org from t_ids)) = 1
  and exists (select 1 from public.notifications where user_id = 'ef000000-0000-4000-8000-0000000000a1' and title like 'Ben opened a file of%'), '');
select pg_temp.res('the teammate is told it was allowed', exists (select 1 from public.notifications where user_id = 'ef000000-0000-4000-8000-0000000000b2' and title like 'You can open the files of%for 24 hours'), '');
update public.file_grants set expires_at = now() - interval '1 minute' where id = (select g from t_ids);
select pg_temp.as_user('ef000000-0000-4000-8000-0000000000b2'); set local role authenticated;
select pg_temp.res('when the OK runs out, the file locks again', not pg_temp.sees((select path from t_ids)), '');
reset role;
select pg_temp.as_user('ef000000-0000-4000-8000-0000000000a1'); set local role authenticated;
select pg_temp.res('the owner sees who opened what', (public.file_access_state((select org from t_ids)) -> 'opens' -> 0 ->> 'who') = 'Ben', public.file_access_state((select org from t_ids))::text);
select pg_temp.res('the switch can''t be flipped by editing the workspace directly', pg_temp.err(format($q$update public.orgs set file_mode = 'open' where id = %L$q$, (select org from t_ids))) like '%permission denied%', '');
reset role;

select n, step, ok, info from t_res order by n;
rollback;
