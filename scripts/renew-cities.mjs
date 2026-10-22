// What each public renewal guide (renew/<slug>/) says about its city. Only two kinds of facts belong here:
//  - links on the city's own official website (gov.ph), for "where to renew";
//  - things a named news outlet or the city reported, each with its source and when it applied.
// Nothing is guessed: a city without an official link we could confirm simply says to ask its business
// permits office. CHECKED is the date these were last reviewed; update it whenever you re-check them.
export const CHECKED = '2026-10-22';

const MB = 'Manila Bulletin';

export const CITIES = [
  {
    slug: 'quezon-city', name: 'Quezon City', area: 'Metro Manila',
    office: 'Business Permits and Licensing Department (BPLD)',
    official: [
      { label: 'QC E-Services (renew and pay online)', url: 'https://qceservices.quezoncity.gov.ph/' },
      { label: 'How to renew a business permit (city guide)', url: 'https://quezoncity.gov.ph/qcitizen-guides/how-to-renew-business-permit/' },
    ],
    // Quezon City counts a year from the permit's issue date instead of a fixed January deadline.
    anniversary: true,
    facts: [
      { t: 'The city\'s guide says to file your renewal one year from the issue date of your current permit, so check the date printed on it.', src: ['Quezon City guide, updated January 6, 2026', 'https://quezoncity.gov.ph/qcitizen-guides/how-to-renew-business-permit/'] },
      { t: 'Online, you pay the business tax first, then file through QC E-Services (or a city kiosk) under the Business One-Stop Shop.', src: ['Quezon City guide, updated January 6, 2026', 'https://quezoncity.gov.ph/qcitizen-guides/how-to-renew-business-permit/'] },
      { t: 'The online system can renew a permit automatically when the business meets all local requirements at renewal time.', src: ['Quezon City guide, updated January 6, 2026', 'https://quezoncity.gov.ph/qcitizen-guides/how-to-renew-business-permit/'] },
    ],
  },
  {
    slug: 'manila', name: 'Manila', area: 'Metro Manila', office: 'Bureau of Permits, Manila City Hall',
    facts: [
      { t: 'In 2026 the City Treasurer extended the renewal deadline to February 13, without interest, penalties or surcharges.', src: [MB + ', February 1, 2026', 'https://mb.com.ph/2026/02/01/manila-logs-increase-in-processed-business-permits-in-2026'] },
      { t: 'By January 30, 2026 the city had logged 46,577 renewals, so expect long lines close to the deadline.', src: [MB + ', February 1, 2026', 'https://mb.com.ph/2026/02/01/manila-logs-increase-in-processed-business-permits-in-2026'] },
    ],
  },
  {
    slug: 'makati', name: 'Makati', area: 'Metro Manila', office: 'Business Permits Office, Makati City Hall',
    facts: [
      { t: 'In 2026 City Ordinance No. 2026-002 moved the penalty-free deadline for the assessment and payment of business permits from January 20 to January 26, and for business licenses to February 2. The ordinance was reported on January 21, a day after the original deadline.', src: ['BusinessWorld, January 21, 2026', 'https://bworldonline.com/the-nation/2026/01/21/725708/makati-extends-tax-permits-deadline/'] },
    ],
  },
  {
    slug: 'taguig', name: 'Taguig', area: 'Metro Manila', office: 'Business Permits and Licensing Office (BPLO)',
    official: [{ label: 'Taguig Local Cloud portal (online applications)', url: 'https://tlcportal.taguig.gov.ph/' }],
    facts: [
      { t: 'For 2026 the city set renewals from January 2 to 20, online through the Taguig Local Cloud portal or in person.', src: [MB + ', December 15, 2025', 'https://mb.com.ph/2025/12/15/business-permit-renewal-in-taguig-set-in-january'] },
      { t: 'The City Treasurer\'s Office accepted cash, credit and debit cards, GCash, Maya and manager\'s checks.', src: [MB + ', December 15, 2025', 'https://mb.com.ph/2025/12/15/business-permit-renewal-in-taguig-set-in-january'] },
    ],
  },
  {
    slug: 'pasig', name: 'Pasig', area: 'Metro Manila', office: 'Business Permits and Licensing Office (BPLO)',
    facts: [
      { t: 'In 2025 the city extended the renewal deadline from January 20 to January 31.', src: ['Malaya Business Insight, January 2025', 'https://malaya.com.ph/news/national-news/pasig-lgu-extends-business-permit-deadline'] },
    ],
  },
  {
    slug: 'mandaluyong', name: 'Mandaluyong', area: 'Metro Manila', office: 'Business Permits and Licensing Department (BPLD)',
    official: [{ label: 'Business Permits and Licensing Department (city website)', url: 'https://mandaluyong.gov.ph/business-permits-and-licensing-department/' }],
    facts: [],
  },
  {
    slug: 'pasay', name: 'Pasay', area: 'Metro Manila', office: 'Business Permits and Licensing Office (BPLO)',
    official: [{ label: 'How do I renew my business permit? (BPLO guide, PDF)', url: 'https://pasay.gov.ph/Resources/BPLO/HOW%20DO%20I%20RENEW%20MY%20BUSINESS%20PERMIT.pdf' }],
    facts: [
      { t: 'In 2026 the city extended the renewal deadline to January 30.', src: [MB + ', January 22, 2026', 'https://mb.com.ph/2026/01/22/pasay-lgu-extends-business-permit-renewal-deadline-until-jan-30'] },
    ],
  },
  {
    slug: 'paranaque', name: 'Parañaque', area: 'Metro Manila', office: 'Business Permits and Licensing Office (BPLO)',
    facts: [
      { t: 'For 2026, renewals ran January 5 to 20 on a schedule set by the last digit of your Business Identification Number (BIN). Renewing on your day avoided late penalties.', src: [MB + ', December 21, 2025', 'https://mb.com.ph/2025/12/21/prepare-early-for-business-permit-renewal-paranaque-lgu-tells-business-owners'] },
      { t: 'The city also checked CCTV installation under City Ordinance No. 14-03 as part of the 2026 renewal.', src: [MB + ', December 21, 2025', 'https://mb.com.ph/2025/12/21/prepare-early-for-business-permit-renewal-paranaque-lgu-tells-business-owners'] },
    ],
  },
  {
    slug: 'muntinlupa', name: 'Muntinlupa', area: 'Metro Manila', office: 'Business Permits and Licensing Office (BPLO)',
    official: [{ label: 'Muntinlupa City website', url: 'https://www.muntinlupacity.gov.ph/' }],
    facts: [
      { t: 'In 2026 the city ran its renewal hub at the Muntinlupa Sports Center in Barangay Tunasan from January 5 to 20, and took renewals online through its Business E-Payment System (BESt).', src: [MB + ', January 5, 2026', 'https://mb.com.ph/2026/01/05/10-early-bird-taxpayers-in-muntinlupa-recognized'] },
    ],
  },
  {
    slug: 'las-pinas', name: 'Las Piñas', area: 'Metro Manila', office: 'Business Permit and Licensing Office (BPLO)',
    official: [{ label: 'Las Piñas City website', url: 'https://laspinascity.gov.ph/' }],
    facts: [
      { t: 'In 2025 the city extended renewals from January 20 to January 31, without penalties, interest or surcharges.', src: [MB + ', January 24, 2025', 'https://mb.com.ph/2025/1/24/las-pinas-lgu-extends-business-permit-renewal-to-jan-31'] },
      { t: 'In January 2024 it also took renewals at a satellite office in Robinsons Place Las Piñas.', src: ['Daily Tribune, January 4, 2024', 'https://tribune.net.ph/2024/01/04/offsite-services-for-las-pinas-business-renewal'] },
    ],
  },
  {
    slug: 'marikina', name: 'Marikina', area: 'Metro Manila', office: 'Business Permits and Licensing Office (BPLO)',
    official: [
      { label: 'Marikina BPLO website', url: 'https://bplo.marikina.gov.ph/' },
      { label: 'How to renew and pay online (BPLO questions and answers)', url: 'https://bplo.marikina.gov.ph/faq' },
    ],
    facts: [
      { t: 'You can renew online: sign up on the city\'s payment portal, choose the BPLO, enter your business account number, declare last year\'s gross sales, upload your financial statement and quarterly VAT returns, then pay.', src: ['Marikina BPLO website', 'https://bplo.marikina.gov.ph/faq'] },
      { t: 'In 2025 City Ordinance No. 001, s. 2025 moved the deadline from January 20 to June 30, without surcharges or penalties.', src: ['Malaya Business Insight, 2025', 'https://malaya.com.ph/news/national-news/marikina-extends-deadline-of-business-permit-renewal'] },
      { t: 'In 2024 the city allowed renewals without surcharges or penalties until March 31.', src: ['ABS-CBN News, January 16, 2024', 'https://news.abs-cbn.com/business/01/16/24/marikina-extends-business-permit-renewal-period'] },
      { t: 'Small sari-sari stores and carinderias have been exempt from the city\'s business tax. Ask the BPLO whether yours qualifies.', src: ['Philippine Information Agency, January 16, 2024', 'https://pia.gov.ph/news/2024/01/16/marikina-extends-business-permit-tax-exemption-for-sari-sari-carinderia-stores'] },
    ],
  },
  {
    slug: 'valenzuela', name: 'Valenzuela', area: 'Metro Manila', office: 'Business Permits and Licensing Office (BPLO)',
    official: [{ label: 'Paspas Permit (renew online)', url: 'https://valenzuela.gov.ph/paspas' }],
    facts: [
      { t: 'Renew online with Paspas Permit: create a 3S Plus Valenzuela City Online Services account with an active email (or log in with your old one), then apply from the Paspas Permit button on the city website.', src: ['Valenzuela City, January 2026', 'https://valenzuela.gov.ph/article/valenzuela-city-welcomes-2026-business-renewal-season-with-several-business-one-stop-shops-boss/'] },
      { t: 'For a renewal the city lists proof of registration (DTI, SEC or CDA), the occupancy permit, and the lease contract if you rent.', src: ['Valenzuela City, Paspas Permit page', 'https://valenzuela.gov.ph/paspas'] },
    ],
  },
  {
    slug: 'caloocan', name: 'Caloocan', area: 'Metro Manila', office: 'Business Permits and Licensing Office (BPLO)',
    facts: [
      { t: 'In 2025 the BPLO opened on weekends until January 20, and the city gave a 10% discount on the business tax to those who renewed by then.', src: [MB + ', January 12, 2025', 'https://mb.com.ph/2025/1/12/caloocan-city-gov-t-extends-bplo-schedule-on-weekends-to-accommodate-business-owners'] },
    ],
  },
  {
    slug: 'cebu-city', name: 'Cebu City', area: 'Cebu', office: 'Business Permit and Licensing Office (BPLO)',
    facts: [
      { t: 'In 2026 renewals ran from January 5 to January 30 after a council resolution extended the window. Payments after January 30 got the 25% surcharge plus 2% interest a month.', src: ['SunStar Cebu, January 2026', 'https://www.sunstar.com.ph/cebu/cebu-tri-cities-extend-biz-permit-deadline'] },
      { t: 'The city took payments online through its official website, with a QR code to start your application ahead of time.', src: ['SunStar Cebu, January 2026', 'https://www.sunstar.com.ph/cebu/cebu-tri-cities-extend-biz-permit-deadline'] },
    ],
  },
  {
    slug: 'mandaue', name: 'Mandaue', area: 'Cebu', office: 'Business Permit and Licensing Office (BPLO)',
    facts: [
      { t: 'In 2026 the city moved the application deadline to January 25, and allowed business tax payments until January 31.', src: ['The Philippine Star, January 21, 2026', 'https://www.philstar.com/cebu-news/2026/01/21/2502445/mandaue-city-extends-deadline-business-permit-applications'] },
    ],
  },
  {
    slug: 'davao-city', name: 'Davao City', area: 'Davao', office: 'City Business Bureau',
    official: [
      { label: 'City Business Bureau (city website)', url: 'https://davaocity.gov.ph/business-bureau/' },
      { label: 'Online payment of business taxes', url: 'https://appbts.davaocity.gov.ph/' },
    ],
    contact: 'busbureau@davaocity.gov.ph · (082) 241-1000 local 377 or 378',
    facts: [],
  },
];

// The 2026 season at a glance, for the guides' index: when renewals were really due in each city.
export const SEASON_2026 = [
  { city: 'Taguig', due: 'January 20', note: 'No extension reported' },
  { city: 'Parañaque', due: 'January 20', note: 'By last digit of the BIN, January 5–20' },
  { city: 'Muntinlupa', due: 'January 20', note: 'Hub open January 5–20' },
  { city: 'Mandaue', due: 'January 25', note: 'Taxes until January 31' },
  { city: 'Makati', due: 'January 26', note: 'Business licenses until February 2' },
  { city: 'Pasay', due: 'January 30', note: 'Extended from January 20' },
  { city: 'Cebu City', due: 'January 30', note: 'Extended by council resolution' },
  { city: 'Manila', due: 'February 13', note: 'Extended, no penalties' },
];
