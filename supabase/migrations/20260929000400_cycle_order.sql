-- The "current" permit record is the most recently recorded one. created_at can tie
-- (two records saved in one transaction), so order by an always-increasing number.
alter table public.requirement_cycles add column seq bigint generated always as identity;
create index requirement_cycles_req_seq_idx on public.requirement_cycles(requirement_id, seq desc);

create or replace view public.requirement_status with (security_invoker = true) as
select
  r.id, r.org_id, r.subject, r.business_id, r.location_id, r.vehicle_id, r.type_code, r.name,
  r.expires, r.confidence, r.notes, r.renewal_started_at, r.created_at, r.updated_at,
  coalesce(b.name, v.make_model) as subject_name,
  v.plate_no,
  l.name as location_name, l.city as location_city, l.is_main as location_is_main,
  c.id as cycle_id, c.reference_no, c.issuer, c.issued_on, c.expires_on,
  coalesce(dc.n, 0)::int as document_count,
  ar.id as open_request_id, ar.status as open_request_status,
  (c.expires_on - t.today) as days_left,
  s.base_status,
  case when ar.id is not null or r.renewal_started_at is not null then 'in_progress' else s.base_status end as status,
  coalesce(c.expires_on < t.today, false) as is_overdue,
  case
    when ar.id is not null or r.renewal_started_at is not null then 'record_renewal'
    when s.base_status in ('action_required','renew_soon') then 'renew'
    when s.base_status = 'needs_information' and r.expires and c.expires_on is null then 'add_details'
    when s.base_status = 'needs_information' and c.id is null then 'add_details'
    when s.base_status = 'needs_information' then 'upload'
  end as next_action
from public.requirements r
cross join lateral (select private.today_ph() as today) t
left join public.businesses b on b.id = r.business_id
left join public.business_locations l on l.id = r.location_id
left join public.vehicles v on v.id = r.vehicle_id
left join lateral (
  select c.* from public.requirement_cycles c
  where c.requirement_id = r.id and c.deleted_at is null
  order by c.seq desc limit 1
) c on true
left join lateral (
  select count(*) as n from public.documents d where d.cycle_id = c.id and d.deleted_at is null
) dc on true
left join lateral (
  select a.id, a.status from public.assistance_requests a
  where a.requirement_id = r.id and a.status not in ('completed','cancelled')
  order by a.created_at desc limit 1
) ar on true
cross join lateral (
  select case
    when c.id is null then 'needs_information'
    when not r.expires then case when coalesce(dc.n, 0) > 0 then 'compliant' else 'needs_information' end
    when c.expires_on is null then 'needs_information'
    when c.expires_on < t.today then 'action_required'
    when c.expires_on <= t.today + 30 then 'renew_soon'
    when coalesce(dc.n, 0) > 0 then 'compliant'
    else 'needs_information'
  end as base_status
) s
where r.deleted_at is null
  and (b.id is null or b.deleted_at is null)
  and (l.id is null or l.deleted_at is null)
  and (v.id is null or v.deleted_at is null);
