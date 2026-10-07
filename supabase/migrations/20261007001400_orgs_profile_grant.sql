-- Fix: the team-tools profile columns were added without letting workspace admins change them,
-- so choosing a workspace type (Settings, or "Start free trial" on the landing page), editing a
-- managed client's contact details, and setting a mall's required permits all failed with
-- "permission denied for table orgs". The orgs_rename policy still limits this to the workspace's
-- owner/admins, and the orgs_guard trigger still protects plan, trial and deletion fields.
grant update (name, kind, contact_name, contact_email, required_types) on public.orgs to authenticated;
alter table public.orgs add constraint orgs_required_types_size check (cardinality(required_types) <= 40);
