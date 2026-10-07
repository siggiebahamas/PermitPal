-- End-to-end check of the app's real backend flows, run as two pretend users (a business owner and
-- a head office) plus a visitor without an account. Everything happens inside one transaction that is
-- ROLLED BACK at the end, so nothing is saved and no email is sent.
-- Run it in Supabase > SQL Editor. Every row in the result should say ok = true.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon;
grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as $f$ insert into pg_temp.t_res(step, ok, info) values (s, ok, coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
 ('0000aaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sweep-owner@example.org', now(), '{"first_name":"Sweep","last_name":"Owner"}','{"provider":"email","providers":["email"]}', now(), now()),
 ('0000aaaa-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sweep-hq@example.org', now(), '{"first_name":"Sweep","last_name":"HQ"}','{"provider":"email","providers":["email"]}', now(), now());

do $$
declare
  u1 uuid := '0000aaaa-0000-4000-8000-000000000001';
  u2 uuid := '0000aaaa-0000-4000-8000-000000000002';
  c1 text := json_build_object('sub', '0000aaaa-0000-4000-8000-000000000001', 'role', 'authenticated', 'email', 'sweep-owner@example.org')::text;
  c2 text := json_build_object('sub', '0000aaaa-0000-4000-8000-000000000002', 'role', 'authenticated', 'email', 'sweep-hq@example.org')::text;
  o1 uuid; o2 uuid; b1 uuid; l1 uuid; v jsonb; p1 uuid; r jsonb; mp uuid; cyc uuid; veh uuid; lnk uuid; tok text; stok text; j jsonb; n int; s text; okb boolean;
begin
  -- ================================================================ business owner
  perform set_config('request.jwt.claims', c1, true);
  execute 'set local role authenticated';
  begin select count(*) into n from public.profiles where id = u1; perform pg_temp.res('sign-up creates a profile', n = 1, n::text); exception when others then perform pg_temp.res('sign-up creates a profile', false, sqlerrm); end;
  begin select count(*) into n from public.notification_prefs where user_id = u1; perform pg_temp.res('sign-up creates reminder settings', n = 1, n::text); exception when others then perform pg_temp.res('sign-up creates reminder settings', false, sqlerrm); end;
  begin o1 := public.create_org('Sweep Test Co'); select count(*) into n from public.org_members where org_id = o1 and user_id = u1 and role = 'owner'; perform pg_temp.res('create workspace (you are owner)', n = 1, ''); exception when others then perform pg_temp.res('create workspace (you are owner)', false, sqlerrm); end;
  begin update public.profiles set current_org_id = o1 where id = u1; get diagnostics n = row_count; perform pg_temp.res('switch current workspace', n = 1, ''); exception when others then perform pg_temp.res('switch current workspace', false, sqlerrm); end;
  begin update public.profiles set first_name = 'Sweepy', role_title = 'Owner' where id = u1; get diagnostics n = row_count; perform pg_temp.res('edit my profile', n = 1, ''); exception when others then perform pg_temp.res('edit my profile', false, sqlerrm); end;
  begin update public.notification_prefs set remind_7 = false where user_id = u1; get diagnostics n = row_count; perform pg_temp.res('change reminder settings', n = 1, ''); exception when others then perform pg_temp.res('change reminder settings', false, sqlerrm); end;
  begin b1 := public.create_business(o1, 'Sweep Bakery', 'Sole Proprietorship', 'restaurant', 'Makati City', 'Ayala Ave'); select count(*) into n from public.requirements where business_id = b1; perform pg_temp.res('add business (checklist is built)', n > 0, n || ' permits'); exception when others then perform pg_temp.res('add business (checklist is built)', false, sqlerrm); end;
  begin l1 := public.add_location(b1, 'Second branch', 'Pasig City', ''); select count(*) into n from public.requirements where location_id = l1; perform pg_temp.res('add branch', l1 is not null, n || ' branch permits'); exception when others then perform pg_temp.res('add branch', false, sqlerrm); end;
  begin v := public.create_vehicle(o1, 'Toyota Vios', 'ABC 1234', 'Sedan', 'CR-1', null, 'OR-1', current_date + 200, 'Malayan', 'POL-1', current_date + 100); veh := (v->>'vehicle_id')::uuid;
        perform pg_temp.res('add vehicle with OR/CR + CTPL', veh is not null and v->'registration'->>'cycle_id' is not null and v->'ctpl'->>'cycle_id' is not null, ''); exception when others then perform pg_temp.res('add vehicle with OR/CR + CTPL', false, sqlerrm); end;
  begin p1 := public.create_person(o1, 'Juan Dela Cruz', 'Driver', b1, array['drivers_license']); select count(*) into n from public.requirements where person_id = p1; perform pg_temp.res('add staff with a licence', n = 1, n::text); exception when others then perform pg_temp.res('add staff with a licence', false, sqlerrm); end;
  begin r := public.add_requirement('business', b1, null, null, 'Signage permit', true, 'SG-1', 'City Hall', current_date - 3, current_date + 360); perform pg_temp.res('add a custom permit with its record', r->>'requirement_id' is not null, ''); exception when others then perform pg_temp.res('add a custom permit with its record', false, sqlerrm); end;
  begin select id into mp from public.requirements where business_id = b1 and type_code = 'mayors_permit' order by location_id nulls first limit 1;
        insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on, amount_paid) values (o1, mp, 'MP-2026', current_date - 5, current_date + 300, 4500) returning id into cyc;
        select status into s from public.requirement_status where id = mp; perform pg_temp.res('record a permit (no file yet = needs info)', s = 'needs_information', s); exception when others then perform pg_temp.res('record a permit (no file yet = needs info)', false, sqlerrm); end;
  begin insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name, mime_type, size_bytes) values (o1, mp, cyc, o1 || '/' || mp || '/x-permit.pdf', 'permit.pdf', 'application/pdf', 1000);
        select status into s from public.requirement_status where id = mp; perform pg_temp.res('attach the file (now compliant)', s = 'compliant', s); exception when others then perform pg_temp.res('attach the file (now compliant)', false, sqlerrm); end;
  begin update public.requirement_cycles set reference_no = 'MP-2026-A' where id = cyc; get diagnostics n = row_count; perform pg_temp.res('edit record details', n = 1, ''); exception when others then perform pg_temp.res('edit record details', false, sqlerrm); end;
  begin insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on) values (o1, mp, 'MP-2027', current_date, current_date + 365);
        select status into s from public.requirement_status where id = mp; perform pg_temp.res('renew without the new file (needs info)', s = 'needs_information', s); exception when others then perform pg_temp.res('renew without the new file (needs info)', false, sqlerrm); end;
  begin update public.requirements set renewal_started_at = now() where id = (select id from public.requirements where business_id = b1 and type_code = 'fsic' limit 1);
        select count(*) into n from public.requirement_status where business_id = b1 and status = 'in_progress'; perform pg_temp.res('"I started the renewal" (in progress)', n >= 1, n::text); exception when others then perform pg_temp.res('"I started the renewal" (in progress)', false, sqlerrm); end;
  begin update public.requirements set confidence = 'confirmed' where business_id = b1; get diagnostics n = row_count; perform pg_temp.res('"Yes, it applies"', n > 0, n::text); exception when others then perform pg_temp.res('"Yes, it applies"', false, sqlerrm); end;
  begin update public.vehicles set deleted_at = now() where id = veh; update public.vehicles set deleted_at = null where id = veh; get diagnostics n = row_count; perform pg_temp.res('delete + restore from Trash', n = 1, ''); exception when others then perform pg_temp.res('delete + restore from Trash', false, sqlerrm); end;
  begin select count(*) into n from public.audit_log where org_id = o1 and entity in ('vehicles'); perform pg_temp.res('History: "Vehicles" filter', n >= 3, n::text); exception when others then perform pg_temp.res('History: "Vehicles" filter', false, sqlerrm); end;
  begin select count(*) into n from public.audit_log where org_id = o1 and entity in ('requirements', 'requirement_cycles'); perform pg_temp.res('History: "Permits & renewals" filter', n >= 3, n::text); exception when others then perform pg_temp.res('History: "Permits & renewals" filter', false, sqlerrm); end;
  begin select count(*) into n from public.audit_log where org_id = o1 and entity in ('documents'); perform pg_temp.res('History: "Files" filter', n >= 1, n::text); exception when others then perform pg_temp.res('History: "Files" filter', false, sqlerrm); end;
  begin insert into public.compliance_shares (org_id, scope, label, show_refs, expires_at) values (o1, 'org', 'For the bank', true, now() + interval '30 days') returning token into stok; perform pg_temp.res('create a share link', stok is not null, ''); exception when others then perform pg_temp.res('create a share link', false, sqlerrm); end;
  begin insert into public.org_invites (org_id, email, role) values (o1, 'teammate@example.org', 'member'); get diagnostics n = row_count; perform pg_temp.res('invite a teammate', n = 1, ''); exception when others then perform pg_temp.res('invite a teammate', false, sqlerrm); end;
  begin perform public.request_plan(o1, 'fleet', 'sweep test'); perform pg_temp.res('choose a plan ("I have paid")', true, ''); exception when others then perform pg_temp.res('choose a plan ("I have paid")', false, sqlerrm); end;
  begin perform public.contact_support('question', 'Sweep test message', null, null, o1); perform pg_temp.res('Contact PermitPal (signed in)', true, ''); exception when others then perform pg_temp.res('Contact PermitPal (signed in)', false, sqlerrm); end;
  begin select count(*) into n from public.list_professionals(); perform pg_temp.res('Find a professional loads', true, n || ' listed'); exception when others then perform pg_temp.res('Find a professional loads', false, sqlerrm); end;
  begin perform public.request_org_deletion(o1); perform public.cancel_org_deletion(o1); perform pg_temp.res('delete workspace, then undo', true, ''); exception when others then perform pg_temp.res('delete workspace, then undo', false, sqlerrm); end;
  begin update public.orgs set name = 'Sweep Test Company' where id = o1; get diagnostics n = row_count; perform pg_temp.res('rename workspace', n = 1, ''); exception when others then perform pg_temp.res('rename workspace', false, sqlerrm); end;
  begin select count(*) into n from public.requirement_status where org_id = o1; perform pg_temp.res('dashboard data loads', n > 0, n || ' items'); exception when others then perform pg_temp.res('dashboard data loads', false, sqlerrm); end;

  -- ================================================================ visitor opening the share link
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin j := public.get_shared_compliance(stok); perform pg_temp.res('share link opens for a visitor', j->>'org_name' is not null and jsonb_array_length(j->'items') > 0, coalesce(j->>'error', j->>'org_name')); exception when others then perform pg_temp.res('share link opens for a visitor', false, sqlerrm); end;
  begin j := public.get_shared_compliance('nope-this-is-not-a-real-token'); perform pg_temp.res('bad share link shows a message', j ? 'error', j::text); exception when others then perform pg_temp.res('bad share link shows a message', false, sqlerrm); end;
  begin select count(*) into n from public.businesses; perform pg_temp.res('visitor cannot read businesses', n = 0, n::text); exception when others then perform pg_temp.res('visitor cannot read businesses', true, 'blocked: ' || sqlerrm); end;
  begin perform public.contact_support('privacy', 'Please delete my data', 'Visitor', 'visitor@example.org', null); perform pg_temp.res('Contact PermitPal (no account)', true, ''); exception when others then perform pg_temp.res('Contact PermitPal (no account)', false, sqlerrm); end;

end $$;
reset role;
do $$
declare
  u1 uuid := '0000aaaa-0000-4000-8000-000000000001';
  c1 text := json_build_object('sub', '0000aaaa-0000-4000-8000-000000000001', 'role', 'authenticated', 'email', 'sweep-owner@example.org')::text;
  c2 text := json_build_object('sub', '0000aaaa-0000-4000-8000-000000000002', 'role', 'authenticated', 'email', 'sweep-hq@example.org')::text;
  o1 uuid; o2 uuid; f1 uuid; cl uuid; pr uuid; fl uuid; b1 uuid; lnk uuid; tok text; j jsonb; n int; s text; okb boolean;
begin
  perform set_config('request.jwt.claims', c1, true);
  execute 'set local role authenticated';
  o1 := public.create_org('Sweep Branch Co');
  b1 := public.create_business(o1, 'Sweep Branch Bakery', 'Sole Proprietorship', 'restaurant', 'Makati City', '');
  begin update public.orgs set kind = 'fleet' where id = o1; update public.orgs set kind = 'business' where id = o1; select kind into s from public.orgs where id = o1; perform pg_temp.res('Settings: change workspace type and back', s = 'business', s); exception when others then perform pg_temp.res('Settings: change workspace type and back', false, sqlerrm); end;

  perform set_config('request.jwt.claims', c2, true);
  begin o2 := public.create_org('Sweep HQ'); update public.orgs set kind = 'head_office', contact_name = 'HQ Admin' where id = o2; select trial_ends_at is not null into okb from public.orgs where id = o2; perform pg_temp.res('switch to Head office (trial starts)', okb, ''); exception when others then perform pg_temp.res('switch to Head office (trial starts)', false, sqlerrm); end;
  begin update public.orgs set plan_id = 'head_office' where id = o2; select plan_id into s from public.orgs where id = o2; perform pg_temp.res('customer cannot give themselves a paid plan', s is distinct from 'head_office', coalesce(s, 'null')); exception when others then perform pg_temp.res('customer cannot give themselves a paid plan', true, 'blocked: ' || sqlerrm); end;
  begin update public.orgs set trial_ends_at = now() + interval '5 years' where id = o2; perform pg_temp.res('customer cannot extend their trial', false, 'update allowed'); exception when others then perform pg_temp.res('customer cannot extend their trial', true, 'blocked: ' || sqlerrm); end;
  begin update public.orgs set kind = 'fleet' where id = o1; get diagnostics n = row_count; perform pg_temp.res('cannot change someone else''s workspace', n = 0, n::text); exception when others then perform pg_temp.res('cannot change someone else''s workspace', true, 'blocked: ' || sqlerrm); end;
  begin lnk := public.link_invite(o2, 'franchisee', 'sweep-owner@example.org', 'Branch 1'); select token into tok from public.org_links where id = lnk; perform pg_temp.res('invite a franchisee', tok is not null, ''); exception when others then perform pg_temp.res('invite a franchisee', false, sqlerrm); end;

  perform set_config('request.jwt.claims', c1, true);
  begin j := public.link_preview(tok); perform pg_temp.res('franchisee sees who invited them', j->>'owner_name' = 'Sweep HQ', coalesce(j->>'owner_name', j::text)); exception when others then perform pg_temp.res('franchisee sees who invited them', false, sqlerrm); end;
  begin perform public.link_accept(tok, o1, true); select count(*) into n from public.org_links where id = lnk and status = 'active'; perform pg_temp.res('accept the connection', n = 1, ''); exception when others then perform pg_temp.res('accept the connection', false, sqlerrm); end;
  begin j := public.my_connections(o1); perform pg_temp.res('Settings shows the connection', jsonb_array_length(j) = 1, ''); exception when others then perform pg_temp.res('Settings shows the connection', false, sqlerrm); end;

  perform set_config('request.jwt.claims', c2, true);
  begin j := public.network_board(o2); perform pg_temp.res('Branches board shows the franchisee', not coalesce((j->>'locked')::boolean, false) and jsonb_array_length(j->'members') = 1 and jsonb_array_length(j->'members'->0->'items') > 0, 'members ' || jsonb_array_length(coalesce(j->'members', '[]'))); exception when others then perform pg_temp.res('Branches board shows the franchisee', false, sqlerrm); end;
  begin perform public.network_documents(o2, o1); perform pg_temp.res('board can list shared copies', true, ''); exception when others then perform pg_temp.res('board can list shared copies', false, sqlerrm); end;
  begin perform public.link_set_label(lnk, 'QC-014'); select label into s from public.org_links where id = lnk; perform pg_temp.res('edit branch note', s = 'QC-014', s); exception when others then perform pg_temp.res('edit branch note', false, sqlerrm); end;
  begin n := public.network_nudge(o2, array[lnk], array[]::uuid[], 'Please renew your permits'); perform pg_temp.res('send a reminder', n = 1, n::text); exception when others then perform pg_temp.res('send a reminder', false, sqlerrm); end;
  begin n := public.network_nudge(o2, array[lnk], array[]::uuid[], 'again'); perform pg_temp.res('no repeat reminder the same day', n = 0, n::text); exception when others then perform pg_temp.res('no repeat reminder the same day', true, 'blocked: ' || sqlerrm); end;
  begin pr := public.create_org('Sweep Mall'); update public.orgs set kind = 'property', required_types = array['mayors_permit','fsic','sanitary_permit'] where id = pr; select cardinality(required_types) into n from public.orgs where id = pr; perform pg_temp.res('Tenants: set required permits', n = 3, n::text); exception when others then perform pg_temp.res('Tenants: set required permits', false, sqlerrm); end;
  begin f1 := public.create_org('Sweep Accounting'); update public.orgs set kind = 'firm' where id = f1;
        cl := public.create_org('Client: Sari-sari Store'); update public.orgs set contact_name = 'Aling Nena', contact_email = 'nena@example.org' where id = cl;
        perform public.create_business(cl, 'Nena Store', 'Sole Proprietorship', 'retail', 'Quezon City', '');
        j := public.network_board(f1); perform pg_temp.res('Clients board shows a managed client', exists (select 1 from jsonb_array_elements(j->'members') m where m->>'via' = 'managed'), 'members ' || jsonb_array_length(coalesce(j->'members', '[]'))); exception when others then perform pg_temp.res('Clients board shows a managed client', false, sqlerrm); end;
  begin n := public.network_nudge(f1, array[]::uuid[], array[cl], 'Your permits are due'); perform pg_temp.res('remind a managed client by email', n = 1, n::text); exception when others then perform pg_temp.res('remind a managed client by email', false, sqlerrm); end;
  begin update public.orgs set contact_email = 'not-an-email' where id = cl; perform pg_temp.res('bad client email is refused', false, 'accepted'); exception when others then perform pg_temp.res('bad client email is refused', true, 'blocked'); end;
  begin fl := public.create_org('Sweep Fleet'); update public.orgs set kind = 'fleet' where id = fl; perform public.create_vehicle(fl, 'Isuzu NPR', 'NAB 1234', 'Truck', '', null, 'OR-9', current_date + 20, null, null, null); j := public.network_board(fl); perform pg_temp.res('Fleet workspace works', true, coalesce(j->>'kind', '')); exception when others then perform pg_temp.res('Fleet workspace works', false, sqlerrm); end;

  perform set_config('request.jwt.claims', c1, true);
  begin select count(*) into n from public.notifications where user_id = u1; perform pg_temp.res('franchisee got the reminder', n >= 1, n::text); exception when others then perform pg_temp.res('franchisee got the reminder', false, sqlerrm); end;
  begin perform public.link_set_sharing(lnk, false); select share_files into okb from public.org_links where id = lnk; perform pg_temp.res('stop sharing file copies', okb = false, ''); exception when others then perform pg_temp.res('stop sharing file copies', false, sqlerrm); end;
  begin perform public.link_end(lnk); select status into s from public.org_links where id = lnk; perform pg_temp.res('disconnect from head office', s = 'ended', s); exception when others then perform pg_temp.res('disconnect from head office', false, sqlerrm); end;
  perform set_config('request.jwt.claims', c2, true);
  begin j := public.network_board(o2); perform pg_temp.res('board no longer shows them after disconnect', jsonb_array_length(coalesce(j->'members', '[]')) = 0, 'members ' || jsonb_array_length(coalesce(j->'members', '[]'))); exception when others then perform pg_temp.res('board no longer shows them after disconnect', false, sqlerrm); end;
end $$;
reset role;
select n, step, ok, left(info, 100) as info from pg_temp.t_res order by n;
rollback;
