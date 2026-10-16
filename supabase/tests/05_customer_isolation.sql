-- Customer isolation: customer B tries to read, change and delete customer A's rows in EVERY table that has an
-- org_id, and to plant rows in A's workspace; a visitor without an account tries to read every table.
-- Run in Supabase > SQL Editor (rolled back, nothing is kept). Every row should say ok = true.
begin;
create temp table r (tbl text, seen int, updated int, deleted int, note text); grant all on r to authenticated, anon;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('aaaaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@test.local','{"first_name":"Ana"}', now()),
 ('bbbbbbbb-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@test.local','{"first_name":"Ben"}', now());
create temp table ids (org_a uuid, biz uuid, veh jsonb, person uuid, req uuid); grant all on ids to authenticated; insert into ids default values;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
update ids set org_a = public.create_org('Victim Co');
update ids set biz = public.create_business(org_a, 'Victim Store', 'Corporation', 'restaurant', 'Makati City', '');
update ids set veh = public.create_vehicle(org_a, 'Isuzu Elf', 'ABC 1234', 'Van', 'CR-1', null, 'OR-1', current_date + 30, 'Malayan', 'POL-1', current_date + 60);
update ids set person = public.create_person(org_a, 'Juan Victim', 'Driver', null, array['drivers_license']);
update ids set req = (select id from public.requirements where business_id = (select biz from ids) limit 1);
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on, amount_paid) select org_a, req, 'MP-1', current_date + 10, 5000 from ids;
insert into public.compliance_shares (org_id, scope, subject_id, label) select org_a, 'business', biz, 'landlord' from ids;
reset role;
-- B signs up and makes a workspace of their own
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.create_org('Attacker Co');
do $$ declare t text; a uuid := (select org_a from ids); s int; u int; d int; note text;
begin
  for t in select c.table_name from information_schema.columns c join information_schema.tables x using (table_schema, table_name)
           where c.table_schema = 'public' and c.column_name = 'org_id' and x.table_type = 'BASE TABLE' order by 1 loop
    s := null; u := null; d := null; note := '';
    begin execute format('select count(*) from public.%I where org_id = $1', t) using a into s; exception when others then note := note || 'read:' || left(sqlerrm, 40) || ' '; end;
    begin execute format('with x as (update public.%I set org_id = org_id where org_id = $1 returning 1) select count(*) from x', t) using a into u; exception when others then note := note || 'upd:' || left(sqlerrm, 40) || ' '; end;
    begin execute format('with x as (delete from public.%I where org_id = $1 returning 1) select count(*) from x', t) using a into d; exception when others then note := note || 'del:' || left(sqlerrm, 40); end;
    insert into r values (t, s, u, d, note);
  end loop;
  -- also: can B plant rows inside A's workspace?
  begin insert into public.businesses (org_id, name) values (a, 'planted'); insert into r values ('INSERT businesses into victim', 1, null, null, 'ALLOWED');
  exception when others then insert into r values ('INSERT businesses into victim', 0, null, null, 'blocked: ' || left(sqlerrm, 50)); end;
  begin perform public.create_business(a, 'planted', 'Corporation', 'retail', '', ''); insert into r values ('create_business() in victim', 1, null, null, 'ALLOWED');
  exception when others then insert into r values ('create_business() in victim', 0, null, null, 'blocked: ' || left(sqlerrm, 50)); end;
  begin perform public.create_person(a, 'x', 'x', null, array['drivers_license']); insert into r values ('create_person() in victim', 1, null, null, 'ALLOWED');
  exception when others then insert into r values ('create_person() in victim', 0, null, null, 'blocked: ' || left(sqlerrm, 50)); end;
  begin insert into public.org_members (org_id, user_id, role) values (a, auth.uid(), 'owner'); insert into r values ('join victim as owner', 1, null, null, 'ALLOWED');
  exception when others then insert into r values ('join victim as owner', 0, null, null, 'blocked: ' || left(sqlerrm, 50)); end;
  begin execute 'select count(*) from storage.objects' into s; insert into r values ('storage.objects visible', s, null, null, ''); exception when others then insert into r values ('storage.objects', null, null, null, left(sqlerrm, 50)); end;
end $$;
reset role;
-- anonymous visitor
set local role anon;
do $$ declare t text; s int; begin
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' loop
    begin execute format('select count(*) from public.%I', t) into s; if s > 0 then insert into r values ('ANON reads ' || t, s, null, null, 'rows visible'); end if;
    exception when others then null; end;
  end loop;
  begin insert into public.services (code, name) values ('x', 'x'); insert into r values ('ANON insert services', 1, null, null, 'ALLOWED'); exception when others then insert into r values ('ANON insert services', 0, null, null, 'blocked'); end;
end $$;
reset role;
select tbl, (coalesce(seen,0) + coalesce(updated,0) + coalesce(deleted,0) = 0 or tbl in ('ANON reads services', 'ANON reads plans')) and note not like '%ALLOWED%' as ok,
       seen, updated, deleted, note from r order by ok, tbl;  -- services and plans are the public catalogue and price list
rollback;
