-- History: every change to customer data is written to audit_log by triggers, so the
-- History page shows who changed what and when, and nothing depends on the browser
-- remembering to log it. Deletes are soft (deleted_at) and restorable from Trash.

create table public.audit_log (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references public.orgs(id) on delete cascade,
  actor_id        uuid references auth.users(id) on delete set null,
  entity          text not null,
  entity_id       uuid not null,
  action          text not null,
  summary         text not null,
  business_id     uuid,
  vehicle_id      uuid,
  requirement_id  uuid,
  old_data        jsonb,
  new_data        jsonb,
  created_at      timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log(org_id, created_at desc);
create index audit_log_business_idx on public.audit_log(business_id, created_at desc) where business_id is not null;
create index audit_log_vehicle_idx on public.audit_log(vehicle_id, created_at desc) where vehicle_id is not null;
create index audit_log_requirement_idx on public.audit_log(requirement_id, created_at desc) where requirement_id is not null;

alter table public.audit_log enable row level security;
create policy audit_log_read on public.audit_log for select to authenticated
  using (org_id in (select private.my_org_ids()));
revoke insert, update, delete on public.audit_log from anon, authenticated;
revoke all on public.audit_log from anon;

create function private.fmt_date(d date) returns text
language sql immutable set search_path = '' as $$
  select case when d is null then 'no date' else to_char(d, 'Mon FMDD, YYYY') end
$$;

create function private.vehicle_label(p_vehicle uuid) returns text
language sql stable security definer set search_path = '' as $$
  select v.make_model || case when v.plate_no <> '' then ' (' || v.plate_no || ')' else '' end
  from public.vehicles v where v.id = p_vehicle
$$;

-- "Mayor's Permit - Corner Bakery (Cebu branch)" style label for a requirement.
create function private.requirement_label(p_req uuid) returns text
language sql stable security definer set search_path = '' as $$
  select '"' || r.name || '" for ' ||
    coalesce(b.name || case when l.id is not null and not l.is_main then ' (' || l.name || ')' else '' end,
             private.vehicle_label(r.vehicle_id), 'a deleted record')
  from public.requirements r
  left join public.businesses b on b.id = r.business_id
  left join public.business_locations l on l.id = r.location_id
  where r.id = p_req
$$;

create function private.help_status_label(s text) returns text
language sql immutable set search_path = '' as $$
  select case s
    when 'submitted' then 'Submitted'
    when 'matching' then 'Finding a provider'
    when 'provider_contacted' then 'Provider contacted'
    when 'awaiting_customer' then 'Waiting for you'
    when 'in_progress' then 'In progress'
    when 'completed' then 'Completed'
    when 'cancelled' then 'Cancelled'
    else s end
$$;

create function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_action  text;
  v_summary text;
  v_org     uuid;
  v_biz     uuid;
  v_veh     uuid;
  v_req     uuid;
  v_label   text;
  v_prior   int;
begin
  if coalesce(current_setting('pp.quiet_audit', true), 'off') = 'on' then return null; end if;

  if tg_op = 'UPDATE' then
    -- Ignore saves that did not actually change anything.
    if (v_old - 'updated_at') = (v_new - 'updated_at') then return null; end if;
    if (v_old->>'deleted_at') is null and (v_new->>'deleted_at') is not null then v_action := 'deleted';
    elsif (v_old->>'deleted_at') is not null and (v_new->>'deleted_at') is null then v_action := 'restored';
    else v_action := 'updated';
    end if;
  elsif tg_op = 'INSERT' then v_action := 'created';
  else v_action := 'removed';
  end if;

  v_org := (v_row->>'org_id')::uuid;

  if tg_table_name = 'businesses' then
    v_biz := (v_row->>'id')::uuid;
    v_summary := case v_action
      when 'created' then 'Added business "' || (v_new->>'name') || '"'
      when 'deleted' then 'Deleted business "' || (v_new->>'name') || '"'
      when 'restored' then 'Restored business "' || (v_new->>'name') || '"'
      else case when (v_old->>'name') <> (v_new->>'name')
                then 'Renamed business "' || (v_old->>'name') || '" to "' || (v_new->>'name') || '"'
                else 'Updated details for business "' || (v_new->>'name') || '"' end
    end;

  elsif tg_table_name = 'business_locations' then
    if tg_op = 'INSERT' and (v_new->>'is_main')::boolean then return null; end if;
    v_biz := (v_row->>'business_id')::uuid;
    select name into v_label from public.businesses where id = v_biz;
    v_summary := case v_action
      when 'created' then 'Added branch "' || (v_new->>'name') || '" to ' || v_label
      when 'deleted' then 'Deleted branch "' || (v_new->>'name') || '" of ' || v_label
      when 'restored' then 'Restored branch "' || (v_new->>'name') || '" of ' || v_label
      else 'Updated branch "' || (v_new->>'name') || '" of ' || v_label
    end;

  elsif tg_table_name = 'vehicles' then
    v_veh := (v_row->>'id')::uuid;
    v_label := (v_row->>'make_model') || case when coalesce(v_row->>'plate_no', '') <> '' then ' (' || (v_row->>'plate_no') || ')' else '' end;
    v_summary := case v_action
      when 'created' then 'Added vehicle ' || v_label
      when 'deleted' then 'Deleted vehicle ' || v_label
      when 'restored' then 'Restored vehicle ' || v_label
      else 'Updated details for vehicle ' || v_label
    end;

  elsif tg_table_name = 'requirements' then
    v_req := (v_row->>'id')::uuid;
    v_biz := (v_row->>'business_id')::uuid;
    v_veh := (v_row->>'vehicle_id')::uuid;
    v_label := private.requirement_label(v_req);
    v_summary := case
      when v_action = 'created' then 'Added ' || v_label
      when v_action = 'deleted' then 'Deleted ' || v_label
      when v_action = 'restored' then 'Restored ' || v_label
      when (v_old->>'renewal_started_at') is null and (v_new->>'renewal_started_at') is not null then 'Started renewing ' || v_label
      when (v_old->>'renewal_started_at') is not null and (v_new->>'renewal_started_at') is null then 'Stopped tracking the renewal of ' || v_label
      else 'Updated ' || v_label
    end;

  elsif tg_table_name = 'requirement_cycles' then
    v_req := (v_row->>'requirement_id')::uuid;
    select business_id, vehicle_id into v_biz, v_veh from public.requirements where id = v_req;
    v_label := private.requirement_label(v_req);
    if v_action = 'created' then
      select count(*) into v_prior from public.requirement_cycles
       where requirement_id = v_req and id <> (v_new->>'id')::uuid and deleted_at is null;
      v_action := case when v_prior > 0 then 'renewed' else 'recorded' end;
      v_summary := case when v_prior > 0 then 'Renewed ' else 'Recorded ' end || v_label ||
        case when (v_new->>'expires_on') is not null then ' - expires ' || private.fmt_date((v_new->>'expires_on')::date) else '' end;
    elsif v_action = 'updated' then
      v_summary := 'Updated the record for ' || v_label ||
        case when (v_old->>'expires_on') is distinct from (v_new->>'expires_on')
             then ' - expiry ' || private.fmt_date((v_old->>'expires_on')::date) || ' to ' || private.fmt_date((v_new->>'expires_on')::date)
             else '' end ||
        case when (v_old->>'reference_no') is distinct from (v_new->>'reference_no')
             then ' - reference no. ' || coalesce(v_new->>'reference_no', 'removed')
             else '' end;
    else
      v_summary := initcap(v_action) || ' a past record of ' || v_label;
    end if;

  elsif tg_table_name = 'documents' then
    v_req := (v_row->>'requirement_id')::uuid;
    select business_id, vehicle_id into v_biz, v_veh from public.requirements where id = v_req;
    v_label := private.requirement_label(v_req);
    v_summary := case v_action
      when 'created' then 'Uploaded "' || (v_new->>'file_name') || '" for ' || v_label
      when 'deleted' then 'Removed file "' || (v_new->>'file_name') || '" from ' || v_label
      when 'restored' then 'Restored file "' || (v_new->>'file_name') || '" to ' || v_label
      else 'Updated file "' || (v_new->>'file_name') || '"'
    end;
    if v_action = 'created' then v_action := 'uploaded'; end if;

  elsif tg_table_name = 'assistance_requests' then
    v_req := (v_row->>'requirement_id')::uuid;
    select business_id, vehicle_id into v_biz, v_veh from public.requirements where id = v_req;
    if v_action = 'created' then
      v_summary := 'Requested help with "' || (v_new->>'requirement_name') || '" for ' || (v_new->>'subject_label');
    elsif (v_old->>'status') is distinct from (v_new->>'status') then
      v_summary := 'Help request for "' || (v_new->>'requirement_name') || '" is now: ' || private.help_status_label(v_new->>'status');
    else
      v_summary := 'Help request for "' || (v_new->>'requirement_name') || '" was updated';
    end if;

  elsif tg_table_name = 'org_members' then
    -- Members disappearing because the whole workspace is being erased: nothing to log.
    if tg_op = 'DELETE' and not exists (select 1 from public.orgs where id = v_org) then return null; end if;
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), p.email, 'A team member') into v_label
      from public.profiles p where p.id = (v_row->>'user_id')::uuid;
    v_summary := case tg_op
      when 'INSERT' then v_label || ' joined the team as ' || (v_new->>'role')
      when 'DELETE' then v_label || ' was removed from the team'
      else v_label || '''s role changed from ' || (v_old->>'role') || ' to ' || (v_new->>'role')
    end;
    v_row := v_row || jsonb_build_object('id', v_row->>'user_id');

  elsif tg_table_name = 'orgs' then
    v_org := (v_row->>'id')::uuid;
    v_summary := case
      when (v_old->>'deleted_at') is null and (v_new->>'deleted_at') is not null then 'Workspace deletion requested - data will be erased on ' || private.fmt_date((v_new->>'purge_after')::date)
      when (v_old->>'deleted_at') is not null and (v_new->>'deleted_at') is null then 'Workspace deletion cancelled'
      when (v_old->>'name') <> (v_new->>'name') then 'Renamed workspace to "' || (v_new->>'name') || '"'
      when (v_old->>'plan_id') <> (v_new->>'plan_id') or (v_old->>'plan_expires_at') is distinct from (v_new->>'plan_expires_at')
        then 'Plan set to ' || coalesce((select name from public.plans where id = v_new->>'plan_id'), v_new->>'plan_id') ||
             case when (v_new->>'plan_expires_at') is not null then ' until ' || private.fmt_date((v_new->>'plan_expires_at')::date) else '' end
      else null
    end;
    if v_summary is null then return null; end if;
  end if;

  insert into public.audit_log (org_id, actor_id, entity, entity_id, action, summary, business_id, vehicle_id, requirement_id, old_data, new_data)
  values (v_org, auth.uid(), tg_table_name, (v_row->>'id')::uuid, v_action, v_summary, v_biz, v_veh, v_req,
          case when tg_op <> 'INSERT' then v_old end, v_new);
  return null;
end $$;

create trigger businesses_audit after insert or update on public.businesses for each row execute function private.audit();
create trigger business_locations_audit after insert or update on public.business_locations for each row execute function private.audit();
create trigger vehicles_audit after insert or update on public.vehicles for each row execute function private.audit();
create trigger requirements_audit after insert or update on public.requirements for each row execute function private.audit();
create trigger requirement_cycles_audit after insert or update on public.requirement_cycles for each row execute function private.audit();
create trigger documents_audit after insert or update on public.documents for each row execute function private.audit();
create trigger assistance_requests_audit after insert or update on public.assistance_requests for each row execute function private.audit();
create trigger org_members_audit after insert or update or delete on public.org_members for each row execute function private.audit();
create trigger orgs_audit after update on public.orgs for each row execute function private.audit();

-- The cycle trigger's housekeeping update (clearing "renewal started") is part of the
-- renewal, not a separate change, so keep it out of History. Restore the previous quiet
-- setting afterwards so an outer quiet block (e.g. create_vehicle) stays quiet.
create or replace function private.on_cycle_recorded() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev text := coalesce(current_setting('pp.quiet_audit', true), 'off');
begin
  perform set_config('pp.quiet_audit', 'on', true);
  update public.requirements
     set renewal_started_at = null, confidence = 'confirmed'
   where id = new.requirement_id and (renewal_started_at is not null or confidence <> 'confirmed');
  perform set_config('pp.quiet_audit', v_prev, true);
  return new;
end $$;
