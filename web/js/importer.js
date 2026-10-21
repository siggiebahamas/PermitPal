// Checking spreadsheet rows before anything is saved: businesses, branches, vehicles, staff and permit
// records. Every row comes back as "ready", "ready with a note" or "skipped, and why", in plain words,
// so a typo or a wrong date never slips in quietly. Pure logic (no screen, no database), so it is tested
// on its own; ctx is the workspace's current data.
import { parseDate, isAmbiguousDate } from './csv.js';

export const MAX_ROWS = 500;
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const plate = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();

// How similar two names are (0..1), to suggest "Did you mean ...?" for typos.
function similarity(a, b) {
  a = key(a); b = key(b);
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > Math.max(m, n) / 2) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
const closest = (name, list, get) => {
  let best = null, score = 0;
  for (const x of list) { const s = similarity(name, get(x)); if (s > score) { score = s; best = x; } }
  return score >= 0.6 ? best : null;
};
const didYouMean = (name, list, get) => { const c = closest(name, list, get); return c ? ` Did you mean "${get(c)}"?` : ''; };

// ---------------------------------------------------------------- word lists
const ACTIVITY_WORDS = [
  ['restaurant', /restaurant|food|\bcaf[eé]|coffee|bakery|bakeshop|eatery|carinderia|catering|kitchen|\bbar\b|\bgrill|canteen|\bresto\b/],
  ['healthcare', /clinic|health|medical|dental|pharmacy|drugstore|hospital|laborator|diagnostic|wellness/],
  ['school', /school|training|education|tutorial|academy|learning|review center/],
  ['manufacturing', /manufactur|factory|production|\bplant\b|processing|fabricat/],
  ['construction', /construct|contractor|builder|engineering|renovation/],
  ['logistics', /logistic|delivery|trucking|courier|transport|hauling|freight|forwarding|warehouse/],
  ['professional_services', /services|professional|consult|accounting|\blaw\b|\blegal\b|agency|marketing|\bbpo\b|\bsalon\b|\bspa\b|laundry|repair/],
  ['retail', /retail|store|shop|\bsari\b|grocery|\bmart\b|trading|merchandise|boutique|hardware|distribut|wholesale|supply/],
];
const ACTIVITY_KEYS = ['restaurant', 'retail', 'professional_services', 'manufacturing', 'construction', 'healthcare', 'school', 'logistics', 'other'];
function activityOf(raw) {
  const s = key(raw).replace(/_/g, ' ');
  if (!s) return { value: 'other', guessed: false };
  const exact = ACTIVITY_KEYS.find((k) => k.replace(/_/g, ' ') === s);
  if (exact) return { value: exact, guessed: false };
  const hit = ACTIVITY_WORDS.find(([, re]) => re.test(s));
  return hit ? { value: hit[0], guessed: false } : { value: 'other', guessed: true };
}
function structureOf(raw, name) {
  const s = key(raw);
  if (/sole|single|proprietor|individual|dti/.test(s)) return { value: 'Sole Proprietorship' };
  if (/partner/.test(s)) return { value: 'Partnership' };
  if (/coop/.test(s)) return { value: 'Cooperative' };
  if (/corp|inc|opc|company|sec/.test(s)) return { value: 'Corporation' };
  if (s) return { value: 'Other', note: `"${raw}" isn't a structure we know: set to Other.` };
  if (/\b(inc|corp|corporation|incorporated|opc)\b\.?/i.test(name || '')) return { value: 'Corporation', note: 'How it is registered was blank: set to Corporation because of the name. Change it if that is wrong.' };
  return { value: 'Sole Proprietorship', note: 'How it is registered was blank: set to Sole Proprietorship. Change it on the business page if that is wrong.' };
}
const VEHICLE_TYPES = ['Sedan', 'SUV', 'Van', 'Pickup', 'Truck', 'Motorcycle', 'Tricycle', 'Bus', 'Other'];
const VEHICLE_SYN = { car: 'Sedan', hatchback: 'Sedan', auv: 'SUV', jeep: 'SUV', mpv: 'Van', minivan: 'Van', 'pick-up': 'Pickup', 'pick up': 'Pickup',
  scooter: 'Motorcycle', motorbike: 'Motorcycle', motor: 'Motorcycle', trike: 'Tricycle', l300: 'Van', lorry: 'Truck', 'wing van': 'Truck' };

// Permit names people write, mapped to the library.
const PERMIT_WORDS = [
  ['mayors_permit', /mayor|business permit|\bbp\b|bplo|municipal permit/],
  ['barangay_clearance', /barangay|brgy/],
  ['fsic', /fsic|fire safety inspection|\bfire\b/],
  ['sanitary_permit', /sanitary/],
  ['bir_cor', /\bbir\b|\bcor\b|2303|certificate of registration \(bir|tax registration/],
  ['dti_business_name', /\bdti\b|business name/],
  ['sec_registration', /\bsec\b/],
  ['cda_registration', /\bcda\b|cooperative development/],
  ['annual_building_inspection', /building inspection|annual inspection/],
  ['signage_permit', /signage|signboard/],
  ['liquor_license', /liquor/],
  ['fda_lto', /\bfda\b/],
  ['dole_registration', /\bdole\b|rule 1020/],
  ['bmbe_certificate', /\bbmbe\b/],
  ['philgeps_platinum', /philgeps/],
  ['ecc', /\becc\b|environmental compliance/],
  ['discharge_permit', /discharge/],
  ['lto_registration', /\bor ?\/? ?cr\b|registration|\blto\b(?!.*licen)/],
  ['ctpl', /ctpl|compulsory/],
  ['comprehensive_insurance', /comprehensive/],
  ['emission_test', /emission|smoke/],
  ['mvir', /mvir|inspection report|pmvic/],
  ['ltfrb_franchise', /ltfrb|franchise|\bcpc\b/],
  ['drivers_license', /driver|driving|license \(lto|\blto licen/],
  ['prc_license', /\bprc\b/],
  ['health_certificate', /health (card|cert)|health certificate/],
  ['nbi_clearance', /\bnbi\b/],
  ['police_clearance', /police/],
  ['tesda_nc', /tesda|\bnc ?(i|ii|iii|iv)\b/],
  ['security_guard_license', /security guard|sosia/],
];
export function permitTypeOf(raw, subject, types) {
  const s = key(raw);
  if (!s) return null;
  const ofKind = types.filter((t) => t.subject === subject);
  const exact = ofKind.find((t) => key(t.name) === s || t.code === s);
  if (exact) return exact;
  for (const [code, re] of PERMIT_WORDS) {
    const t = ofKind.find((x) => x.code === code);
    if (t && re.test(s)) return t;
  }
  return null;
}

// ---------------------------------------------------------------- the kinds
const dateCol = (k, label, example, aliases) => [k, label, example, aliases, true];
export const KINDS = {
  businesses: {
    label: 'Businesses', one: 'business', many: 'businesses', unit: 'One business per row. Each gets its starter permit list.',
    cols: [
      ['name', 'Business name', 'Corner Bakery Corp.', ['businessname', 'name', 'business', 'company', 'companyname', 'tradename', 'registeredname']],
      ['activity', 'What it does', 'Restaurant / food', ['whatitdoes', 'activity', 'industry', 'lineofbusiness', 'natureofbusiness', 'businesstype', 'category']],
      ['structure', 'How it is registered', 'Corporation', ['howitisregistered', 'howisitregistered', 'structure', 'registration', 'ownership', 'type', 'organization']],
      ['city', 'City or municipality', 'Makati City', ['cityormunicipality', 'city', 'municipality', 'citymunicipality', 'town', 'location']],
      ['address', 'Address', '123 Ayala Ave.', ['address', 'streetaddress', 'businessaddress']],
      ['tin', 'TIN', '123-456-789-000', ['tin', 'taxidentificationnumber', 'taxid']],
    ],
    required: ['name'],
    row(get, ctx, seen) {
      const f = { name: get('name').slice(0, 160), city: get('city').slice(0, 120), address: get('address').slice(0, 300), tin: get('tin').slice(0, 30) };
      const problems = [], notes = [];
      if (!f.name) problems.push('Business name is missing');
      const a = activityOf(get('activity'));
      f.activity = a.value;
      if (a.guessed) notes.push(`Couldn't tell what "${get('activity')}" does: set to Other.`);
      const st = structureOf(get('structure'), f.name);
      f.structure = st.value;
      if (st.note) notes.push(st.note);
      const k = key(f.name);
      if (k && ctx.businesses.some((b) => key(b.name) === k)) problems.push('Already in PermitPal');
      else if (k && seen.has(k)) problems.push('This business appears twice in the file');
      if (k) seen.add(k);
      return { f, problems, notes, show: [f.name, f.structure, f.city || '—'] };
    },
    head: ['Business', 'Registered as', 'City'],
  },

  branches: {
    label: 'Branches of a business', one: 'branch', many: 'branches', unit: 'One branch per row. The business must already be in PermitPal.',
    cols: [
      ['business', 'Business name', 'Corner Bakery Corp.', ['businessname', 'business', 'company', 'companyname']],
      ['name', 'Branch name', 'SM North branch', ['branchname', 'branch', 'name', 'store', 'outlet', 'site']],
      ['city', 'City or municipality', 'Quezon City', ['cityormunicipality', 'city', 'municipality', 'town']],
      ['address', 'Address', 'SM North EDSA, Upper Ground', ['address', 'streetaddress']],
    ],
    required: ['business', 'name'],
    row(get, ctx, seen) {
      const f = { name: get('name').slice(0, 120), city: get('city').slice(0, 120), address: get('address').slice(0, 300) };
      const problems = [], notes = [];
      const bname = get('business');
      const b = ctx.businesses.find((x) => key(x.name) === key(bname));
      if (!bname) problems.push('Business name is missing');
      else if (!b) problems.push(`No business called "${bname}" in PermitPal.${didYouMean(bname, ctx.businesses, (x) => x.name)} Import or add the business first.`);
      if (!f.name) problems.push('Branch name is missing');
      f.business_id = b?.id;
      const k = b ? b.id + '|' + key(f.name) : null;
      if (b && f.name && ctx.locations.some((l) => l.business_id === b.id && key(l.name) === key(f.name))) problems.push('This branch is already in PermitPal');
      else if (k && f.name && seen.has(k)) problems.push('This branch appears twice in the file');
      if (k) seen.add(k);
      return { f, problems, notes, show: [b?.name || bname || '—', f.name || '—', f.city || '—'] };
    },
    head: ['Business', 'Branch', 'City'],
  },

  vehicles: {
    label: 'Vehicles', one: 'vehicle', many: 'vehicles', unit: 'One vehicle per row, with its registration and CTPL if you have them.',
    cols: [
      ['make_model', 'Make and model', 'Toyota Hilux', ['makeandmodel', 'makemodel', 'vehicle', 'model', 'make', 'unit', 'description']],
      ['plate_no', 'Plate number', 'NBC 4417', ['platenumber', 'plateno', 'plate', 'platenum', 'conductionsticker']],
      ['vehicle_type', 'Type', 'Pickup', ['type', 'vehicletype', 'kind', 'classification']],
      ['cr_no', 'CR number', '', ['crnumber', 'crno', 'cr']],
      ['or_no', 'OR number', 'OR-5521', ['ornumber', 'orno', 'or']],
      dateCol('registration_expires', 'Registration expires', '2027-03-10', ['registrationexpires', 'registrationexpiry', 'registrationexpiration', 'regexpiry', 'ltoexpiry', 'registrationvaliduntil', 'registration']),
      ['ctpl_provider', 'CTPL provider', 'Malayan Insurance', ['ctplprovider', 'insurer', 'insuranceprovider', 'insurancecompany']],
      ['ctpl_policy_no', 'CTPL policy number', '', ['ctplpolicynumber', 'policynumber', 'policyno', 'cocnumber', 'coc']],
      dateCol('ctpl_expires', 'CTPL expires', '2027-03-10', ['ctplexpires', 'ctplexpiry', 'ctplexpiration', 'insuranceexpiry', 'ctpl']),
    ],
    required: ['make_model'],
    row(get, ctx, seen, date) {
      const f = { make_model: get('make_model').slice(0, 120), plate_no: get('plate_no').toUpperCase().slice(0, 20), cr_no: get('cr_no').slice(0, 40),
        or_no: get('or_no').slice(0, 100), ctpl_provider: get('ctpl_provider').slice(0, 120), ctpl_policy_no: get('ctpl_policy_no').slice(0, 100) };
      const problems = [], notes = [];
      if (!f.make_model) problems.push('Make and model is missing');
      const t = get('vehicle_type');
      f.vehicle_type = VEHICLE_TYPES.find((x) => x.toLowerCase() === t.toLowerCase()) || VEHICLE_SYN[t.toLowerCase()] || (t ? null : 'Other');
      if (!f.vehicle_type) problems.push(`Type "${t}" isn't one of: ${VEHICLE_TYPES.join(', ')}`);
      for (const k of ['registration_expires', 'ctpl_expires']) { const d = date(get(k)); if (d.error) problems.push(d.error); else f[k] = d.value; }
      const p = plate(f.plate_no);
      if (p && ctx.vehicles.some((v) => plate(v.plate_no) === p)) problems.push('Already in PermitPal');
      else if (p && seen.has(p)) problems.push('Same plate appears twice in the file');
      if (p) seen.add(p);
      return { f, problems, notes, show: [f.make_model || '—', f.plate_no || '—', f.registration_expires, f.ctpl_expires] };
    },
    head: ['Vehicle', 'Plate', 'Registration expires', 'CTPL expires'],
    dates: [2, 3],
  },

  staff: {
    label: 'Staff and their licenses', one: 'staff member', many: 'staff members', unit: 'One person per row, with any licenses they carry.',
    cols: [
      ['full_name', 'Full name', 'Juan dela Cruz', ['fullname', 'name', 'employee', 'employeename', 'staff', 'staffname', 'driver', 'drivername']],
      ['role_title', 'Position', 'Driver', ['position', 'role', 'jobtitle', 'title', 'designation']],
      ['business', 'Business', 'Corner Bakery Corp.', ['business', 'company', 'businessname', 'employer']],
      ['drivers_license_no', "Driver's license number", 'N01-23-456789', ['driverslicensenumber', 'driverslicenseno', 'licensenumber', 'licenseno', 'dlnumber', 'dlno']],
      dateCol('drivers_license_expires', "Driver's license expires", '2029-05-14', ['driverslicenseexpires', 'driverslicenseexpiry', 'licenseexpiry', 'licenseexpires', 'dlexpiry', 'dlexpires']),
      dateCol('health_certificate_expires', 'Health certificate expires', '2027-01-31', ['healthcertificateexpires', 'healthcardexpiry', 'healthcardexpires', 'healthcertificateexpiry', 'healthcard']),
      dateCol('nbi_clearance_expires', 'NBI clearance expires', '2027-06-30', ['nbiclearanceexpires', 'nbiexpiry', 'nbiexpires', 'nbiclearanceexpiry', 'nbi']),
      dateCol('police_clearance_expires', 'Police clearance expires', '', ['policeclearanceexpires', 'policeclearanceexpiry', 'policeexpiry', 'policeclearance']),
      ['prc_license_no', 'PRC license number', '', ['prclicensenumber', 'prclicenseno', 'prcno', 'prcnumber']],
      dateCol('prc_license_expires', 'PRC license expires', '', ['prclicenseexpires', 'prcexpiry', 'prcexpires', 'prclicenseexpiry']),
    ],
    required: ['full_name'],
    row(get, ctx, seen, date) {
      const f = { full_name: get('full_name').slice(0, 160), role_title: get('role_title').slice(0, 120), licences: [] };
      const problems = [], notes = [];
      if (!f.full_name) problems.push('Full name is missing');
      const bname = get('business');
      if (bname) {
        const b = ctx.businesses.find((x) => key(x.name) === key(bname));
        if (b) f.business_id = b.id; else notes.push(`Business "${bname}" not found, so not linked.${didYouMean(bname, ctx.businesses, (x) => x.name)}`);
      }
      const lic = [['drivers_license', 'drivers_license_no', 'drivers_license_expires'], ['health_certificate', null, 'health_certificate_expires'],
        ['nbi_clearance', null, 'nbi_clearance_expires'], ['police_clearance', null, 'police_clearance_expires'], ['prc_license', 'prc_license_no', 'prc_license_expires']];
      for (const [code, refKey, expKey] of lic) {
        const ref = refKey ? get(refKey).slice(0, 100) : '';
        const d = date(get(expKey));
        if (d.error) { problems.push(d.error); continue; }
        if (!ref && !d.value) continue;
        const t = ctx.types.find((x) => x.code === code);
        if (!t) { notes.push(`${code.replace(/_/g, ' ')} isn't available yet, so it was left out.`); continue; }
        f.licences.push({ type_code: code, name: t.name, reference_no: ref || null, expires_on: d.value });
        if (d.value && d.value < ctx.today) notes.push(`${t.name} already expired (${d.value}).`);
      }
      const k = key(f.full_name);
      if (k && ctx.people.some((x) => key(x.full_name) === k)) problems.push('Already in PermitPal. To add license dates for existing staff, import "Permit records" instead');
      else if (k && seen.has(k)) problems.push('This person appears twice in the file');
      if (k) seen.add(k);
      return { f, problems, notes, show: [f.full_name || '—', f.role_title || '—', f.licences.map((l) => l.name).join(', ') || 'No licenses'] };
    },
    head: ['Name', 'Position', 'Licenses'],
  },

  permits: {
    label: 'Permit records (numbers and dates)', one: 'permit record', many: 'permit records',
    unit: 'One permit per row: who it belongs to, which permit, and its number and dates. Businesses, vehicles and staff must already be in PermitPal.',
    cols: [
      ['subject', 'For (business, plate or staff name)', 'Corner Bakery Corp.', ['forbusinessplateorstaffname', 'for', 'business', 'businessname', 'vehicle', 'plate', 'platenumber', 'staff', 'name', 'owner', 'holder', 'company']],
      ['branch', 'Branch', 'Main branch', ['branch', 'branchname', 'location', 'store', 'outlet']],
      ['permit', 'Permit', "Mayor's Permit", ['permit', 'permitname', 'requirement', 'document', 'license', 'licence', 'type', 'permittype']],
      ['reference_no', 'Reference number', 'BP-2026-0442', ['referencenumber', 'reference', 'referenceno', 'permitnumber', 'permitno', 'number', 'no', 'ornumber', 'policynumber', 'licensenumber']],
      dateCol('issued_on', 'Issued on', '2026-01-15', ['issuedon', 'issued', 'dateissued', 'issuedate', 'issuancedate']),
      dateCol('expires_on', 'Expires on', '2027-01-20', ['expireson', 'expires', 'expiry', 'expiration', 'expirydate', 'expirationdate', 'validuntil', 'validity', 'due', 'duedate']),
    ],
    required: ['subject', 'permit'],
    row(get, ctx, seen, date) {
      const problems = [], notes = [];
      const who = get('subject');
      const pname = get('permit');
      const f = { reference_no: get('reference_no').slice(0, 100) };
      const di = date(get('issued_on')); const de = date(get('expires_on'));
      if (di.error) problems.push(di.error); else f.issued_on = di.value;
      if (de.error) problems.push(de.error); else f.expires_on = de.value;
      if (!who) problems.push('"For" is missing (the business, plate or staff name)');
      if (!pname) problems.push('Permit name is missing');
      // who it belongs to: a business, a vehicle (by plate or name) or a staff member
      const hits = [];
      if (who) {
        ctx.businesses.filter((b) => key(b.name) === key(who)).forEach((b) => hits.push({ subject: 'business', id: b.id, label: b.name }));
        ctx.vehicles.filter((v) => (v.plate_no && plate(v.plate_no) === plate(who)) || key(v.make_model) === key(who))
          .forEach((v) => hits.push({ subject: 'vehicle', id: v.id, label: `${v.make_model}${v.plate_no ? ' · ' + v.plate_no : ''}` }));
        ctx.people.filter((x) => key(x.full_name) === key(who)).forEach((x) => hits.push({ subject: 'person', id: x.id, label: x.full_name }));
      }
      let s = hits[0];
      if (who && !hits.length) {
        problems.push(`No business, plate or staff member called "${who}".${didYouMean(who, [...ctx.businesses.map((b) => b.name), ...ctx.vehicles.map((v) => v.plate_no).filter(Boolean), ...ctx.people.map((x) => x.full_name)], (x) => x)}`);
      } else if (hits.length > 1) {
        // a permit name can settle it ("OR/CR" only fits a vehicle)
        const fit = hits.filter((h) => permitTypeOf(pname, h.subject, ctx.types));
        if (fit.length === 1) s = fit[0];
        else { problems.push(`"${who}" matches more than one thing (${hits.map((h) => h.subject).join(' and ')}). Use the plate number for vehicles.`); s = null; }
      }
      if (s && pname) {
        const t = permitTypeOf(pname, s.subject, ctx.types);
        f.subject = s.subject; f.subject_id = s.id;
        if (t) { f.type_code = t.code; f.name = t.name; f.expires = t.expires; }
        else { f.name = pname.slice(0, 160); f.expires = !!f.expires_on; notes.push(`"${pname}" isn't in our permit list: it will be added as your own permit.`); }
        // which branch, for permits each branch needs
        if (s.subject === 'business' && (!t || t.per_location)) {
          const locs = ctx.locations.filter((l) => l.business_id === s.id);
          const bname = get('branch');
          const loc = bname ? locs.find((l) => key(l.name) === key(bname) || key(l.city) === key(bname)) : (locs.length === 1 ? locs[0] : locs.find((l) => l.is_main));
          if (bname && !loc) problems.push(`No branch "${bname}" for ${s.label}.${didYouMean(bname, locs, (l) => l.name)}`);
          else if (!bname && locs.length > 1 && t) notes.push(`No branch given: saved to ${loc?.name || 'the main branch'}.`);
          f.location_id = loc?.id || null;
          f.location_label = loc && locs.length > 1 ? loc.name : '';
        }
        if (t && !t.expires && f.expires_on) { notes.push(`${t.name} doesn't expire, so the expiry date is left out.`); f.expires_on = null; }
        if (f.issued_on && f.expires_on && f.expires_on < f.issued_on) problems.push('Expires before it was issued: check the two dates');
        if (f.issued_on && f.issued_on > ctx.today) problems.push('Issued in the future: check the date');
        if (t?.expires && !f.expires_on && !f.reference_no && !f.issued_on) problems.push('Nothing to record: add a reference number or dates');
        if (f.expires_on && f.expires_on < ctx.today) notes.push(`Already expired (${f.expires_on}): it will show as overdue.`);
        // what is already in PermitPal for it
        const existing = ctx.reqs.find((r) => r.subject === s.subject && (r.business_id || r.vehicle_id || r.person_id) === s.id
          && (t ? r.type_code === t.code : key(r.name) === key(f.name)) && (s.subject !== 'business' || !f.location_id || (r.location_id || null) === f.location_id));
        if (existing) {
          f.requirement_id = existing.id;
          if (existing.cycle_id) {
            const sameDates = (existing.expires_on || null) === (f.expires_on || null) && (!f.reference_no || existing.reference_no === f.reference_no);
            if (sameDates) { f.action = 'skip'; notes.push('Already up to date in PermitPal.'); }
            else if (f.expires_on && existing.expires_on && f.expires_on < existing.expires_on) problems.push(`Older than what PermitPal has (expires ${existing.expires_on})`);
            else if (f.expires_on && existing.expires_on && f.expires_on === existing.expires_on) {
              f.action = 'update'; f.cycle_id = existing.cycle_id;
              f.keep = { issuer: existing.issuer, issued_on: f.issued_on || existing.issued_on, expires_on: existing.expires_on, amount_paid: existing.amount_paid };
              notes.push('Adds the reference number to the current record.');
            }
            else { f.action = 'renewal'; notes.push('Saved as the newest record; the old one stays in its history.'); }
          } else f.action = 'record';
        } else f.action = 'add';
        const k = `${s.subject}|${s.id}|${f.type_code || key(f.name)}|${f.location_id || ''}`;
        if (seen.has(k)) problems.push('The same permit appears twice in the file: keep the newest row');
        seen.add(k);
      }
      return { f, problems, notes, show: [s?.label || who || '—', (f.name || pname || '—') + (f.location_label ? ` (${f.location_label})` : ''), f.reference_no || '—', f.expires_on] };
    },
    head: ['For', 'Permit', 'Reference', 'Expires'],
    dates: [3],
  },
};

// Finds the header row (it may be under a title row or two), matches the columns, and checks every row.
export function checkImport(kind, rows, ctx, { dayFirst = false } = {}) {
  const K = KINDS[kind];
  if (!rows.length) return { error: 'The file is empty.' };
  const match = (row) => {
    const header = row.map(norm);
    const idx = {};
    const used = new Set();
    // exact label first, then aliases in order, so "Business name" and "Branch name" land in the right place
    for (const [k, label] of K.cols) { const i = header.findIndex((h, j) => !used.has(j) && h === norm(label)); if (i >= 0) { idx[k] = i; used.add(i); } }
    for (const [k, , , aliases] of K.cols) {
      if (idx[k] != null) continue;
      for (const a of aliases) { const i = header.findIndex((h, j) => !used.has(j) && h === a); if (i >= 0) { idx[k] = i; used.add(i); break; } }
    }
    return idx;
  };
  let hr = -1, idx = {};
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const m = match(rows[i]);
    if (K.required.every((k) => m[k] != null)) { hr = i; idx = m; break; }
  }
  if (hr < 0) {
    const need = K.required.map((k) => `"${K.cols.find((c) => c[0] === k)[1]}"`).join(' and ');
    return { error: `We couldn't find the ${need} column${K.required.length > 1 ? 's' : ''}. Start from our template, or rename your column headings to match it.` };
  }
  const body = rows.slice(hr + 1);
  if (!body.length) return { error: 'The file has headings but no rows under them.' };
  if (body.length > MAX_ROWS) return { error: `That's ${body.length} rows. Import up to ${MAX_ROWS} at a time: split the file and import each part.` };
  const dateKeys = K.cols.filter((c) => c[4]).map((c) => c[0]);
  const ambiguous = body.some((r) => dateKeys.some((k) => idx[k] != null && isAmbiguousDate(r[idx[k]])));
  const date = (raw) => parseDate(raw, { dayFirst });
  const seen = new Set();
  const out = body.map((r, n) => {
    const get = (k) => (idx[k] == null ? '' : String(r[idx[k]] ?? '').replace(/\s+/g, ' ').trim());
    return { line: hr + n + 2, ...K.row(get, ctx, seen, date) };
  });
  return { rows: out, ambiguous, missing: K.cols.filter(([k]) => idx[k] == null).map(([, l]) => l), headerRow: hr + 1 };
}

export const templateRows = (kind, types = []) => {
  const cols = KINDS[kind].cols.filter(([k]) => kind !== 'staff' || !/^police/.test(k) || types.some((t) => t.code === 'police_clearance'));
  return [cols.map((c) => c[1]), cols.map((c) => c[2])];
};
