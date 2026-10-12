export const STATE_COURT_PORTALS: Record<string, string> = {
  AL:'https://judicial.alabama.gov/', AK:'https://courts.alaska.gov/', AZ:'https://www.azcourts.gov/',
  AR:'https://arcourts.gov/', CA:'https://courts.ca.gov/', CO:'https://www.coloradojudicial.gov/',
  CT:'https://jud.ct.gov/', DE:'https://courts.delaware.gov/', FL:'https://www.flcourts.gov/',
  GA:'https://georgiacourts.gov/', HI:'https://www.courts.state.hi.us/', ID:'https://isc.idaho.gov/',
  IL:'https://www.illinoiscourts.gov/', IN:'https://www.in.gov/courts/', IA:'https://www.iowacourts.gov/',
  KS:'https://www.kscourts.org/', KY:'https://www.kycourts.gov/', LA:'https://www.lasc.org/',
  ME:'https://www.courts.maine.gov/', MD:'https://www.mdcourts.gov/', MA:'https://www.mass.gov/orgs/massachusetts-court-system',
  MI:'https://www.courts.michigan.gov/', MN:'https://www.mncourts.gov/', MS:'https://courts.ms.gov/',
  MO:'https://www.courts.mo.gov/', MT:'https://courts.mt.gov/', NE:'https://supremecourt.nebraska.gov/',
  NV:'https://nvcourts.gov/', NH:'https://www.courts.nh.gov/', NJ:'https://www.njcourts.gov/',
  NM:'https://www.nmcourts.gov/', NY:'https://ww2.nycourts.gov/', NC:'https://www.nccourts.gov/',
  ND:'https://www.ndcourts.gov/', OH:'https://www.supremecourt.ohio.gov/', OK:'https://www.oscn.net/',
  OR:'https://www.courts.oregon.gov/', PA:'https://www.pacourts.us/', RI:'https://www.courts.ri.gov/',
  SC:'https://www.sccourts.org/', SD:'https://ujs.sd.gov/', TN:'https://www.tncourts.gov/',
  TX:'https://www.txcourts.gov/', UT:'https://www.utcourts.gov/', VT:'https://www.vermontjudiciary.org/',
  VA:'https://www.vacourts.gov/', WA:'https://www.courts.wa.gov/', WV:'https://www.courtswv.gov/',
  WI:'https://www.wicourts.gov/', WY:'https://www.courts.state.wy.us/', DC:'https://www.dccourts.gov/',
};

import type { CriminalSearchQuery, CriminalSourceCoverage } from './types';
import { getStateCorrectionsInfo } from '../inmateSearch/stateData';

// Public entry points are coverage routes, not evidence about a person.
export const CRIMINAL_CASE_PORTALS: Record<string, { url: string; note: string }> = {
  IA: { url:'https://www.iowacourts.state.ia.us/ESAWebApp/', note:'Basic court search; advanced searches require a subscription. Court entries are not a complete state criminal-history report.' },
  MN: { url:'https://publicaccess.courts.state.mn.us/CaseSearch/', note:'Pending criminal cases do not appear in defendant-name searches. Use a case number or the BCA criminal-history route where appropriate.' },
  WI: { url:'https://wcca.wicourts.gov/', note:'Public circuit-court records; access and retained history vary.' },
  PA: { url:'https://ujsportal.pacourts.us/CaseSearch', note:'Public docket sheets; statewide warrant access is restricted. Official criminal-history checks use Pennsylvania State Police.' },
  OK: { url:'https://www.oscn.net/dockets/Search.aspx', note:'Bounded public criminal-case lookup supported; county and party matching are required.' },
  SD: { url:'https://ujspars.sd.gov/GuestSearch.aspx', note:'PARS guest searches require a birth date and cost $20, including searches with no result. No purchase is made here.' },
  ND: { url:'https://publicsearch.ndcourts.gov/', note:'Public court search; unavailable and nonpublic records are not negative findings.' },
  AZ: { url:'https://apps.azcourts.gov/publicaccess/caselookup.aspx', note:'Public case information; document access is a separate service.' },
  MO: { url:'https://www.courts.mo.gov/casenet/', note:'Case.net public case lookup; document availability varies.' },
  IN: { url:'https://www.in.gov/courts/help/mycase/', note:'MyCase prohibits automated extraction. Use its approved data-access process; no automated portal requests are made here.' },
  NJ: { url:'https://www.njcourts.gov/public/find-a-case', note:'Official case access directory; case-type restrictions apply.' },
  NC: { url:'https://www.nccourts.gov/services', note:'Official court service directory; public portal access varies.' },
};

export function criminalSourceRoutes(query: CriminalSearchQuery): CriminalSourceCoverage[] {
  const retrievedAt = new Date().toISOString();
  const state = query.state?.toUpperCase();
  const rows: CriminalSourceCoverage[] = [];
  const add = (source: string, url: string, note: string, status: CriminalSourceCoverage['status'] = 'manual_required') =>
    rows.push({ source, url, note, status, recordsFound: 0, retrievedAt });
  if (state && STATE_COURT_PORTALS[state]) {
    const portal = CRIMINAL_CASE_PORTALS[state];
    add(`${state} court records`, portal?.url || STATE_COURT_PORTALS[state], portal?.note || 'Official state judiciary entry point. A verified case-search connection is needed; this link was not searched.');
    const corrections = getStateCorrectionsInfo(state);
    if (corrections?.searchUrl) add(`${state} corrections`, corrections.searchUrl, 'Official corrections entry point. No person-level custody search was completed by this link.');
  } else add('State and county courts', 'https://www.usa.gov/state-courts', 'Supply a state and county to select the applicable official sources.', 'not_checked');
  add('Sex-offender registries', 'https://www.nsopw.gov/', 'NSOPW offers browser searches, not a public search API. Registry status remains not checked.');
  add('Local warrants', state && STATE_COURT_PORTALS[state] || 'https://www.usa.gov/state-courts', 'Use the responsible court or sheriff for current warrant confirmation. No nationwide public warrant determination was made.', 'not_checked');
  add('PACER', 'https://pacer.uscourts.gov/', 'No PACER purchase or paid docket refresh is performed. Existing free RECAP copies are searched separately.', 'not_checked');
  return rows;
}
