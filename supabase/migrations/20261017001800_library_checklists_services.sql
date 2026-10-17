-- 1) A fuller permit library: more business, vehicle and staff permits, each with where to file it,
--    the official online portal (only where there is one national portal), how long it is valid,
--    which permits must be done first, and a renewal checklist.
-- 2) Checklist progress per permit. It belongs to the current permit period, so recording the renewal
--    starts a fresh checklist for next time automatically.
-- 3) The done-for-you service is back: customers can have PermitPal renew (or apply for) a permit,
--    with an exact quote first, written authorization, and government fees at cost.
-- Checklists are general guidance: cities and agencies can ask for more or less, and the app says so.

-- ================================================================ library columns
alter table public.requirement_types
  add column if not exists category      text,
  add column if not exists where_to_file text check (where_to_file is null or length(where_to_file) <= 400),
  add column if not exists online_url    text check (online_url is null or online_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^\s]*)?$'),
  add column if not exists online_label  text check (online_label is null or length(online_label) <= 80),
  add column if not exists validity_note text check (validity_note is null or length(validity_note) <= 500),
  add column if not exists depends_on    text[] not null default '{}',
  add column if not exists checklist     jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array');
alter table public.requirement_types drop constraint if exists requirement_types_due_rule_check;
alter table public.requirement_types add constraint requirement_types_due_rule_check
  check (due_rule in ('manual','jan20','annual','lto_plate','years5','years2','months6'));

-- Checklist items: {"k": stable key, "t": what to do or bring, "d": optional detail, "u": optional https link,
-- "dep": optional permit code that is itself tracked (shown with its live status)}.

-- ---------------------------------------------------------------- existing business permits
update public.requirement_types set category = 'local',
  where_to_file = $t$Your city or municipal hall's Business Permits and Licensing Office (BPLO), or its online portal. Many cities open a one-stop shop in January.$t$,
  validity_note = $t$Valid for the calendar year. Most cities want it renewed by January 20; late renewal can add up to a 25% surcharge plus 2% interest a month.$t$,
  depends_on = array['barangay_clearance'],
  checklist = $j$[
    {"k":"brgy","t":"Barangay Business Clearance for this year","dep":"barangay_clearance"},
    {"k":"prev","t":"Last year's Mayor's Permit and its official receipt"},
    {"k":"sales","t":"Last year's gross sales or receipts","d":"Usually copies of your BIR returns, or a sworn declaration of gross sales."},
    {"k":"ctc","t":"Community Tax Certificate (cedula) for the business","d":"From the city or municipal treasurer."},
    {"k":"lease","t":"Proof of address","d":"Lease contract, or the title or tax declaration if you own the place."},
    {"k":"contrib","t":"SSS, PhilHealth and Pag-IBIG proof of payment, if your city asks","d":"Common for businesses with employees."},
    {"k":"fire","t":"Fire safety inspection (FSIC)","d":"Many cities have the fire inspection done as part of the renewal.","dep":"fsic"},
    {"k":"pay","t":"Pay the assessed taxes and fees","d":"Many cities let you pay by quarter. Keep the official receipt."},
    {"k":"claim","t":"Get the new permit and display it at the business"}
  ]$j$::jsonb
where code = 'mayors_permit';

update public.requirement_types set category = 'local',
  where_to_file = $t$The barangay hall where the business (or branch) is located.$t$,
  validity_note = $t$Valid for the calendar year. Needed before you can renew the Mayor's Permit.$t$,
  checklist = $j$[
    {"k":"prev","t":"Last year's barangay clearance"},
    {"k":"lease","t":"Proof of address","d":"Lease contract, or the title or tax declaration if you own the place."},
    {"k":"ctc","t":"Community Tax Certificate (cedula), if your barangay asks"},
    {"k":"pay","t":"Pay the barangay fee and keep the receipt"}
  ]$j$::jsonb
where code = 'barangay_clearance';

update public.requirement_types set category = 'national',
  where_to_file = $t$Your BIR Revenue District Office (RDO), or online through ORUS.$t$,
  online_url = 'https://orus.bir.gov.ph/', online_label = 'BIR ORUS (online registration and updates)',
  validity_note = $t$Does not expire. The ₱500 yearly registration fee was removed in 2024 (Ease of Paying Taxes Act).$t$,
  checklist = $j$[
    {"k":"display","t":"Display the COR (Form 2303) where customers can see it"},
    {"k":"notice","t":"Display the BIR notice asking customers to get an invoice"},
    {"k":"books","t":"Keep your registered books of accounts up to date"},
    {"k":"update","t":"Moved, changed your name or opened a branch? File the update with BIR (Form 1905)","u":"https://orus.bir.gov.ph/"}
  ]$j$::jsonb
where code = 'bir_cor';

update public.requirement_types set category = 'safety',
  where_to_file = $t$The Bureau of Fire Protection station for your city, often through the city's business one-stop shop.$t$,
  validity_note = $t$Valid for one year from the date issued.$t$,
  checklist = $j$[
    {"k":"app","t":"Application form","d":"Often part of the city's business permit application."},
    {"k":"prev","t":"Last year's FSIC"},
    {"k":"occupancy","t":"Copy of the building permit or certificate of occupancy, if asked"},
    {"k":"fsmr","t":"Fire Safety Maintenance Report, if your building needs one","d":"Usually for larger or higher-risk buildings."},
    {"k":"ready","t":"Fire extinguishers refilled and tagged; exits clear and marked"},
    {"k":"pay","t":"Pay the fire code fee","d":"Often 15% of your city's regulatory fees, at least ₱500. The station's assessment decides."},
    {"k":"inspect","t":"Have someone at the site for the inspection"}
  ]$j$::jsonb
where code = 'fsic';

update public.requirement_types set category = 'safety',
  where_to_file = $t$The city or municipal health office (sanitation section).$t$,
  validity_note = $t$Usually valid for one year; many cities follow the calendar year.$t$,
  checklist = $j$[
    {"k":"prev","t":"Last year's sanitary permit"},
    {"k":"cards","t":"Health certificates for staff who handle food or serve customers"},
    {"k":"water","t":"Water analysis (potability) result from an accredited laboratory"},
    {"k":"pest","t":"Pest control certificate"},
    {"k":"inspect","t":"Sanitary inspection of the premises"},
    {"k":"pay","t":"Pay the fee and keep the receipt"}
  ]$j$::jsonb
where code = 'sanitary_permit';

update public.requirement_types set category = 'national',
  where_to_file = $t$Online through DTI's Business Name Registration System.$t$,
  online_url = 'https://bnrs.dti.gov.ph/', online_label = 'DTI Business Name Registration System',
  validity_note = $t$Valid for 5 years. You can usually renew online from 90 days before it expires; late renewals can cost more.$t$,
  checklist = $j$[
    {"k":"online","t":"Renew online and pay the fee","u":"https://bnrs.dti.gov.ph/"},
    {"k":"print","t":"Download and keep the new certificate"}
  ]$j$::jsonb
where code = 'dti_business_name';

update public.requirement_types set category = 'national',
  where_to_file = $t$Online through SEC eFAST.$t$,
  online_url = 'https://efast.sec.gov.ph/', online_label = 'SEC eFAST (yearly filings)',
  validity_note = $t$Does not expire, but missing the yearly filings leads to fines and, in the end, revocation.$t$,
  checklist = $j$[
    {"k":"gis","t":"File the General Information Sheet (GIS) every year","d":"Within 30 days after your annual stockholders' or members' meeting."},
    {"k":"afs","t":"File audited financial statements every year","d":"The deadline depends on your fiscal year and your SEC registration number."},
    {"k":"contact","t":"Keep an official email address and phone number on file with the SEC"}
  ]$j$::jsonb
where code = 'sec_registration';

update public.requirement_types set category = 'national',
  where_to_file = $t$The Cooperative Development Authority office for your region.$t$,
  validity_note = $t$Does not expire, as long as the yearly reports are filed.$t$,
  checklist = $j$[
    {"k":"reports","t":"Submit the yearly reports the CDA requires","d":"Such as the Cooperative Annual Progress Report and audited financial statements. Check the CDA's current list."}
  ]$j$::jsonb
where code = 'cda_registration';

update public.requirement_types set category = 'industry',
  where_to_file = $t$DENR Environmental Management Bureau regional office.$t$,
  validity_note = $t$Does not expire, but you must follow its conditions and submit the monitoring reports it lists.$t$,
  checklist = $j$[
    {"k":"conditions","t":"Follow the conditions written on your ECC"},
    {"k":"reports","t":"Submit the monitoring reports it requires, on time"}
  ]$j$::jsonb
where code = 'ecc';

update public.requirement_types set category = 'industry',
  where_to_file = $t$Philippine Contractors Accreditation Board (PCAB).$t$,
  validity_note = $t$Check the validity printed on your license.$t$,
  checklist = $j$[
    {"k":"docs","t":"Updated company documents","d":"Such as financial statements and your list of technical staff. Check PCAB's current list."},
    {"k":"file","t":"File the renewal before the expiry date"}
  ]$j$::jsonb
where code = 'pcab_license';

update public.requirement_types set category = 'industry',
  where_to_file = $t$Department of Health (health facilities licensing).$t$,
  validity_note = $t$Check the validity printed on your licence.$t$,
  checklist = $j$[
    {"k":"check","t":"Get the DOH checklist for your kind of facility"},
    {"k":"file","t":"File the renewal before the expiry date"}
  ]$j$::jsonb
where code = 'doh_lto';

update public.requirement_types set category = 'industry',
  where_to_file = $t$DepEd, CHED or TESDA, depending on what you teach.$t$
where code = 'school_permit';

-- ---------------------------------------------------------------- existing vehicle permits
update public.requirement_types set category = 'registration',
  where_to_file = $t$Any LTO district office, or online in LTMS for plain renewals.$t$,
  online_url = 'https://portal.lto.gov.ph/', online_label = 'LTO LTMS portal',
  validity_note = $t$Renew every year in the week set by your plate number. Brand-new vehicles are first registered for 3 years. As of October 2026, LTO has extended registrations that expired from July 1, 2026 until further notice (MC MVL-2026-5271): check LTO's latest advisory before paying any penalty.$t$,
  depends_on = array['ctpl','emission_test'],
  checklist = $j$[
    {"k":"ctpl","t":"CTPL insurance for the coming year","dep":"ctpl"},
    {"k":"emission","t":"Passed emission test","d":"At an LTO-accredited emission testing center; the result is sent to LTO.","dep":"emission_test"},
    {"k":"inspect","t":"Vehicle inspection, if your vehicle needs it","dep":"mvir"},
    {"k":"orcr","t":"Current OR/CR"},
    {"k":"pay","t":"Pay the registration fee","d":"Online in LTMS works when your last renewal was also done in LTMS.","u":"https://portal.lto.gov.ph/"}
  ]$j$::jsonb
where code = 'lto_registration';

update public.requirement_types set category = 'registration',
  where_to_file = $t$Any insurance company or agent accredited by the Insurance Commission; many sell online.$t$,
  validity_note = $t$Covers one registration year. Buy it shortly before your registration renewal.$t$,
  checklist = $j$[
    {"k":"orcr","t":"Copy of the OR/CR"},
    {"k":"buy","t":"Buy CTPL for the next registration year"},
    {"k":"coc","t":"Check that the certificate of cover is authenticated, so LTO can see it"}
  ]$j$::jsonb
where code = 'ctpl';

update public.requirement_types set category = 'registration',
  where_to_file = $t$An LTO-accredited private emission testing center.$t$,
  validity_note = $t$Done for each registration renewal.$t$,
  checklist = $j$[
    {"k":"orcr","t":"Bring the OR/CR"},
    {"k":"test","t":"Pass the test shortly before your registration renewal"}
  ]$j$::jsonb
where code = 'emission_test';

update public.requirement_types set category = 'registration',
  where_to_file = $t$An LTO-authorized inspection center (PMVIC) or LTO, if your vehicle needs an inspection.$t$,
  checklist = $j$[
    {"k":"orcr","t":"Bring the OR/CR"},
    {"k":"inspect","t":"Pass the inspection before renewing the registration"}
  ]$j$::jsonb
where code = 'mvir';

update public.requirement_types set category = 'registration' where code = 'comprehensive_insurance';

-- ---------------------------------------------------------------- existing staff licences
update public.requirement_types set category = 'licence',
  where_to_file = $t$Any LTO licensing center. The driver must go in person.$t$,
  online_url = 'https://portal.lto.gov.ph/', online_label = 'LTO LTMS portal',
  validity_note = $t$Valid for 5 years, or 10 years for drivers with no traffic violations.$t$,
  checklist = $j$[
    {"k":"medical","t":"Medical certificate from an LTO-accredited clinic"},
    {"k":"cde","t":"Driver's education module and exam in LTMS, if required for the renewal","u":"https://portal.lto.gov.ph/"},
    {"k":"id","t":"Current license and a valid ID"},
    {"k":"pay","t":"Pay the renewal fee"}
  ]$j$::jsonb
where code = 'drivers_license';

update public.requirement_types set category = 'licence',
  where_to_file = $t$Online through PRC LERIS, then at a PRC office on your appointment.$t$,
  online_url = 'https://online.prc.gov.ph/', online_label = 'PRC LERIS',
  validity_note = $t$The PRC ID is valid for 3 years.$t$,
  checklist = $j$[
    {"k":"cpd","t":"CPD units your profession requires"},
    {"k":"apply","t":"Apply and book an appointment online","u":"https://online.prc.gov.ph/"},
    {"k":"pay","t":"Pay the renewal fee"},
    {"k":"claim","t":"Go to the appointment and claim the new ID"}
  ]$j$::jsonb
where code = 'prc_license';

update public.requirement_types set category = 'clearance',
  where_to_file = $t$The city or municipal health office where the person works.$t$,
  validity_note = $t$Usually valid for one year; some cities set a different period. Check the card.$t$,
  checklist = $j$[
    {"k":"labs","t":"Lab tests the health office asks for","d":"Often a chest X-ray and stool and urine tests."},
    {"k":"seminar","t":"Food safety seminar, if your city requires it"},
    {"k":"pay","t":"Pay the fee and claim the card"}
  ]$j$::jsonb
where code = 'health_certificate';

update public.requirement_types set category = 'clearance',
  where_to_file = $t$Online through the NBI clearance website, then an NBI clearance center.$t$,
  online_url = 'https://clearance.nbi.gov.ph/', online_label = 'NBI Clearance online',
  validity_note = $t$Check the validity printed on the clearance; employers often accept it for 6 months to 1 year.$t$,
  checklist = $j$[
    {"k":"apply","t":"Apply and book online","u":"https://clearance.nbi.gov.ph/"},
    {"k":"ids","t":"Two valid IDs"},
    {"k":"pay","t":"Pay the fee"},
    {"k":"appear","t":"Go for photo and fingerprints, if asked"}
  ]$j$::jsonb
where code = 'nbi_clearance';

-- ---------------------------------------------------------------- new permits (added only when chosen)
insert into public.requirement_types
  (code, name, subject, agency, expires, due_rule, per_location, activities, structures, confidence, auto_add, help_text, sort,
   category, where_to_file, online_url, online_label, validity_note, depends_on, checklist) values
  ('annual_building_inspection', 'Certificate of Annual Inspection (building)', 'business', 'Office of the Building Official', true, 'jan20', true, null, null, 'likely', false,
   $t$Many cities inspect business buildings every year as part of the business permit renewal.$t$, 42,
   'safety', $t$Your city or municipal Office of the Building Official, usually through the business one-stop shop.$t$, null, null,
   $t$Usually valid for the calendar year.$t$, '{}',
   $j$[{"k":"prev","t":"Last year's certificate"},{"k":"inspect","t":"Building inspection"},{"k":"pay","t":"Pay the inspection fee"}]$j$::jsonb),
  ('signage_permit', 'Signage / Signboard Permit', 'business', 'City or municipal hall', true, 'jan20', true, null, null, 'likely', false,
   $t$If you have a business sign. Many cities renew it together with the business permit.$t$, 44,
   'local', $t$Your city or municipal hall, often through the business one-stop shop.$t$, null, null,
   $t$Usually renewed every year with the business permit.$t$, '{}',
   $j$[{"k":"photo","t":"Photo and size of the sign"},{"k":"pay","t":"Pay the signage fee"}]$j$::jsonb),
  ('liquor_license', 'Liquor License', 'business', 'City or municipal hall', true, 'jan20', true, array['restaurant','retail'], null, 'likely', false,
   $t$If you sell or serve alcoholic drinks.$t$, 46,
   'local', $t$Your city or municipal hall (BPLO).$t$, null, null,
   $t$Usually renewed every year with the business permit.$t$, '{}',
   $j$[{"k":"prev","t":"Last year's liquor license"},{"k":"pay","t":"Pay the fee"}]$j$::jsonb),
  ('fda_lto', 'FDA License to Operate', 'business', 'Food and Drug Administration (FDA)', true, 'manual', true, null, null, 'needs_verification', false,
   $t$Needed if you make, import, distribute or sell food products, drugs, cosmetics or medical devices. Restaurants usually need a sanitary permit instead.$t$, 52,
   'industry', $t$Online through the FDA eServices portal.$t$, 'https://www.fda.gov.ph/', 'FDA website and eServices',
   $t$Enter the validity printed on your licence; the FDA sets it per licence.$t$, '{}',
   $j$[{"k":"file","t":"File the renewal online before the expiry date","u":"https://www.fda.gov.ph/"},{"k":"pay","t":"Pay the fee"},{"k":"download","t":"Download and keep the new licence"}]$j$::jsonb),
  ('discharge_permit', 'Wastewater Discharge Permit', 'business', 'DENR-EMB (or LLDA around Laguna Lake)', true, 'manual', true, array['manufacturing'], null, 'needs_verification', false,
   $t$If your business releases wastewater into a river, the sea or the drainage system.$t$, 92,
   'industry', $t$DENR Environmental Management Bureau regional office, or the LLDA around Laguna Lake.$t$, null, null,
   $t$Enter the validity printed on the permit.$t$, '{}',
   $j$[{"k":"lab","t":"Recent wastewater test results"},{"k":"file","t":"File the renewal before the expiry date"}]$j$::jsonb),
  ('dole_registration', 'DOLE Establishment Registration (Rule 1020)', 'business', 'Department of Labor and Employment', false, 'manual', true, null, null, 'confirmed', false,
   $t$One-time registration for every business with at least one employee. Free. Each branch registers.$t$, 130,
   'employer', $t$Online through DOLE's Establishment Report System.$t$, 'https://reports.dole.gov.ph/', 'DOLE Establishment Report System',
   $t$Does not expire. Update it if your address or number of workers changes a lot.$t$, '{}',
   $j$[{"k":"file","t":"Register online","u":"https://reports.dole.gov.ph/"},{"k":"keep","t":"Keep the certificate of registration on file"}]$j$::jsonb),
  ('sss_employer', 'SSS Employer Registration', 'business', 'Social Security System', false, 'manual', false, null, null, 'confirmed', false,
   $t$One-time registration as an employer, before you hire. Monthly contributions are separate.$t$, 132,
   'employer', $t$Online through My.SSS, or any SSS branch.$t$, 'https://www.sss.gov.ph/', 'SSS website (My.SSS)',
   $t$Does not expire.$t$, '{}', '[]'::jsonb),
  ('philhealth_employer', 'PhilHealth Employer Registration', 'business', 'PhilHealth', false, 'manual', false, null, null, 'confirmed', false,
   $t$One-time registration as an employer, before you hire. Monthly contributions are separate.$t$, 134,
   'employer', $t$Any PhilHealth local office, or online where available.$t$, 'https://www.philhealth.gov.ph/', 'PhilHealth website',
   $t$Does not expire.$t$, '{}', '[]'::jsonb),
  ('pagibig_employer', 'Pag-IBIG Employer Registration', 'business', 'Pag-IBIG Fund', false, 'manual', false, null, null, 'confirmed', false,
   $t$One-time registration as an employer, before you hire. Monthly contributions are separate.$t$, 136,
   'employer', $t$Online through Virtual Pag-IBIG, or any Pag-IBIG branch.$t$, 'https://www.pagibigfund.gov.ph/', 'Pag-IBIG Fund website',
   $t$Does not expire.$t$, '{}', '[]'::jsonb),
  ('bmbe_certificate', 'BMBE Certificate of Authority', 'business', 'DTI Negosyo Center', true, 'years2', false, null, null, 'confirmed', false,
   $t$For micro businesses with assets up to ₱3 million (not counting land): no income tax on the business while it is valid.$t$, 140,
   'national', $t$The Negosyo Center or DTI office where the business is located.$t$, null, null,
   $t$Valid for 2 years from the date issued, and renewable every 2 years.$t$, '{}',
   $j$[{"k":"form","t":"BMBE application form"},{"k":"assets","t":"Proof that total assets are still within the limit"},{"k":"file","t":"File before the certificate expires"}]$j$::jsonb),
  ('philgeps_platinum', 'PhilGEPS Platinum Membership', 'business', 'PhilGEPS', true, 'annual', false, null, null, 'confirmed', false,
   $t$Needed to bid for government contracts. Expired documents can get the membership suspended.$t$, 150,
   'national', $t$Online through the PhilGEPS portal.$t$, 'https://www.philgeps.gov.ph/', 'PhilGEPS',
   $t$Valid for one year; renew every year.$t$, '{}',
   $j$[{"k":"docs","t":"Upload your current documents","d":"Such as the Mayor's Permit, tax clearance and registration certificate."},{"k":"pay","t":"Pay the yearly membership fee"},{"k":"cert","t":"Download the new certificate"}]$j$::jsonb),
  ('ltfrb_franchise', 'LTFRB Franchise (CPC)', 'vehicle', 'LTFRB', true, 'manual', false, null, null, 'confirmed', false,
   $t$For vehicles that carry passengers or goods for hire, such as jeepneys, buses, taxis, TNVS and trucks-for-hire. Enter the validity printed on the decision.$t$, 60,
   'for_hire', $t$LTFRB regional office.$t$, null, null,
   $t$Enter the validity printed on the decision; file the extension well before it ends.$t$, '{}',
   $j$[{"k":"file","t":"File for extension of validity before it ends"},{"k":"docs","t":"Current OR/CR and insurance"},{"k":"pay","t":"Pay the fees"}]$j$::jsonb),
  ('police_clearance', 'National Police Clearance', 'person', 'PNP', true, 'months6', false, null, null, 'confirmed', false,
   $t$Often asked of new hires and staff in security or cash-handling work.$t$, 45,
   'clearance', $t$Online through the PNP National Police Clearance System, then a police station for photo and fingerprints.$t$,
   'https://pnpclearance.ph/', 'PNP National Police Clearance System',
   $t$Usually valid for 6 months.$t$, '{}',
   $j$[{"k":"apply","t":"Apply and book online","u":"https://pnpclearance.ph/"},{"k":"ids","t":"Valid IDs"},{"k":"pay","t":"Pay the fee"},{"k":"appear","t":"Go for photo and fingerprints"}]$j$::jsonb),
  ('tesda_nc', 'TESDA National Certificate (NC)', 'person', 'TESDA', true, 'years5', false, null, null, 'confirmed', false,
   $t$Skills certificates such as NC II for cooks, welders, electricians or caregivers.$t$, 50,
   'licence', $t$The TESDA office that issued the certificate.$t$, 'https://www.tesda.gov.ph/', 'TESDA',
   $t$Usually valid for 5 years; check the date printed. If the training rules changed, renewal may need a new assessment.$t$, '{}',
   $j$[{"k":"form","t":"Application form and ID photos"},{"k":"proof","t":"Proof of work in that skill during the last 5 years"},{"k":"file","t":"File at the issuing TESDA office"}]$j$::jsonb),
  ('security_guard_license', 'Security Guard License', 'person', 'PNP Civil Security Group (SOSIA)', true, 'manual', false, null, null, 'confirmed', false,
   $t$Required for every security guard. Enter the validity printed on the license.$t$, 55,
   'licence', $t$PNP Civil Security Group (SOSIA).$t$, null, null,
   $t$Enter the validity printed on the license.$t$, '{}', '[]'::jsonb)
on conflict (code) do nothing;

-- ================================================================ checklist progress
create table public.checklist_progress (
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  org_id          uuid not null references public.orgs(id) on delete cascade,
  round           text not null check (length(round) <= 40),  -- the permit period it belongs to ('first' before any record)
  item            text not null check (item ~ '^[a-z0-9_]{1,40}$'),
  done_by         uuid default auth.uid() references auth.users(id) on delete set null,
  done_at         timestamptz not null default now(),
  primary key (requirement_id, round, item)
);
create index checklist_progress_org on public.checklist_progress(org_id);
alter table public.checklist_progress enable row level security;
create policy checklist_progress_read on public.checklist_progress for select to authenticated
  using (org_id in (select private.my_org_ids()));
revoke insert, update, delete, truncate on public.checklist_progress from authenticated;
revoke all on public.checklist_progress from anon;

-- Tick or untick one item. The period is worked out here, not sent by the browser, so two people
-- ticking at the same time on an old page can't put ticks on the wrong renewal.
create or replace function public.set_checklist_item(p_req uuid, p_item text, p_done boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare v_r public.requirements; v_round text;
begin
  select * into v_r from public.requirements where id = p_req and deleted_at is null;
  if v_r.id is null or v_r.org_id not in (select private.my_writable_org_ids()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.requirement_types t, jsonb_array_elements(t.checklist) e
                 where t.code = v_r.type_code and e ->> 'k' = p_item) then
    raise exception 'That checklist item no longer exists. Refresh the page.' using errcode = '22023';
  end if;
  select coalesce(s.cycle_id::text, 'first') into v_round from public.requirement_status s where s.id = p_req;
  if coalesce(p_done, false) then
    insert into public.checklist_progress (requirement_id, org_id, round, item, done_by)
    values (p_req, v_r.org_id, coalesce(v_round, 'first'), p_item, auth.uid())
    on conflict do nothing;
  else
    delete from public.checklist_progress where requirement_id = p_req and round = coalesce(v_round, 'first') and item = p_item;
  end if;
  return coalesce(v_round, 'first');
end $$;
revoke all on function public.set_checklist_item(uuid, text, boolean) from public, anon;
grant execute on function public.set_checklist_item(uuid, text, boolean) to authenticated;

-- ================================================================ done-for-you service, back on
-- What the customer asked for (renew an existing permit, or apply for one they don't have yet) and
-- when they authorized PermitPal to act for them.
alter table public.assistance_requests
  add column if not exists kind text not null default 'renew' check (kind in ('renew','apply','other')),
  add column if not exists consented_at timestamptz;

-- Customers can't rewrite these afterwards (staff and the order functions can).
create or replace function private.assistance_lock_extra() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_platform_admin() then
    new.kind := old.kind; new.consented_at := old.consented_at;
  end if;
  return new;
end $$;
drop trigger if exists assistance_lock_extra on public.assistance_requests;
create trigger assistance_lock_extra before update on public.assistance_requests
  for each row execute function private.assistance_lock_extra();

drop function if exists public.request_service(uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,text);
create or replace function public.request_service(
  p_org uuid, p_service text, p_requirement uuid default null, p_business uuid default null, p_vehicle uuid default null,
  p_person uuid default null, p_notes text default null, p_rush boolean default false,
  p_contact_method text default 'email', p_contact_value text default null, p_docs_status text default 'not_sure',
  p_kind text default 'renew', p_consent boolean default false
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if not coalesce(p_consent, false) then
    raise exception 'Please tick the box to confirm PermitPal may act for you on this request.' using errcode = '22023';
  end if;
  if coalesce(p_kind, 'renew') not in ('renew','apply','other') then raise exception 'Unknown request type.' using errcode = '22023'; end if;
  -- A workspace can't flood the team with requests (each one emails the founder).
  if (select count(*) from public.assistance_requests where org_id = p_org and status not in ('completed','cancelled')) >= 25 then
    raise exception 'You have 25 open requests. Wait for some to finish, or cancel ones you no longer need.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.assistance_requests where org_id = p_org and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'That''s a lot of requests in one hour. Please try again a little later, or message us.' using errcode = 'P0001';
  end if;
  insert into public.assistance_requests (org_id, service_code, requirement_id, business_id, vehicle_id, person_id,
    requirement_name, subject_label, notes, rush, contact_method, contact_value, docs_status, kind, consented_at)
  values (p_org, p_service, p_requirement, p_business, p_vehicle, p_person, '-', '-',
    nullif(btrim(p_notes), ''), coalesce(p_rush, false), coalesce(p_contact_method, 'email'), nullif(btrim(p_contact_value), ''),
    coalesce(p_docs_status, 'not_sure'), coalesce(p_kind, 'renew'), now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_service(uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,text,text,boolean) from public, anon;
grant execute on function public.request_service(uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,text,text,boolean) to authenticated;

-- Everything else in the order flow comes back exactly as it was before it was switched off.
do $$ declare f text; begin
  foreach f in array array[
    'public.accept_quote(uuid)', 'public.add_order_message(uuid,text,text,text)', 'public.submit_payment(uuid,text,text,text,text)',
    'public.order_payment_start(uuid)', 'public.admin_quote_request(uuid,numeric,numeric,text)', 'public.admin_confirm_payment(uuid,boolean,text)',
    'public.admin_update_order(uuid,text,text,text,text,numeric,text)', 'public.admin_refund_order(uuid,numeric,text,text,text,text)',
    'public.staff_open_file(text)', 'public.admin_record_renewal(uuid,text,text,date,date,numeric,text,text,text,bigint)'] loop
    if to_regprocedure(f) is not null then execute format('grant execute on function %s to authenticated', f); end if;
  end loop;
end $$;

-- A few more services that match the fuller library.
insert into public.services (code, name, category, summary, includes, price_from, price_unit, turnaround, applies_to, type_codes, sort) values
  ('renew_dti_business_name', 'DTI business name renewal', 'renewal',
   'We renew your business name online and save the new certificate to your account.',
   array['Renewal filed online','Fee at cost, receipt uploaded','New certificate saved to your account'],
   500, 'per business name', '1-3 working days', 'business', array['dti_business_name'], 70),
  ('renew_philgeps', 'PhilGEPS Platinum renewal', 'renewal',
   'We update your PhilGEPS documents and renew your Platinum membership.',
   array['Documents checked and uploaded','Membership fee at cost','New certificate saved to your account'],
   2000, 'per year', '3-10 working days', 'business', array['philgeps_platinum'], 75),
  ('apply_dole_registration', 'DOLE establishment registration', 'document',
   'We register your business (or a branch) with DOLE and save the certificate to your account.',
   array['Online filing','Certificate saved to your account'],
   1500, 'per branch', '3-10 working days', 'business', array['dole_registration'], 330),
  ('apply_bmbe', 'BMBE certificate (income tax exemption)', 'document',
   'We check if your business qualifies and file for (or renew) your BMBE Certificate of Authority.',
   array['Eligibility check','Filing at the Negosyo Center','Certificate saved to your account'],
   1500, 'one-time', '1-3 weeks', 'business', array['bmbe_certificate'], 340)
on conflict (code) do nothing;
-- Renewals can also be first-time applications: say so in the catalog.
update public.services set summary = summary || ' Don''t have it yet? We can apply for it too.'
where category = 'renewal' and code not in ('renew_ctpl', 'renew_other') and summary not like '%apply for it too%';

insert into private.features (name) values ('library2'), ('services') on conflict do nothing;
