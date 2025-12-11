/**
 * State Corrections Department Data
 * 
 * Contains information about each state's Department of Corrections
 * including their inmate lookup URLs and API availability
 */

import type { StateCorrectionsInfo } from './types';

export const STATE_CORRECTIONS: Record<string, StateCorrectionsInfo> = {
  'AL': {
    state: 'AL',
    stateName: 'Alabama',
    departmentName: 'Alabama Department of Corrections',
    searchUrl: 'https://doc.alabama.gov/InmateSearch',
    apiAvailable: false,
  },
  'AK': {
    state: 'AK',
    stateName: 'Alaska',
    departmentName: 'Alaska Department of Corrections',
    searchUrl: 'https://doc.alaska.gov/vinelink',
    apiAvailable: false,
  },
  'AZ': {
    state: 'AZ',
    stateName: 'Arizona',
    departmentName: 'Arizona Department of Corrections, Rehabilitation & Reentry',
    searchUrl: 'https://corrections.az.gov/public-resources/inmate-datasearch',
    apiAvailable: false,
  },
  'AR': {
    state: 'AR',
    stateName: 'Arkansas',
    departmentName: 'Arkansas Division of Correction',
    searchUrl: 'https://apps.ark.org/inmate_info/index.php',
    apiAvailable: false,
  },
  'CA': {
    state: 'CA',
    stateName: 'California',
    departmentName: 'California Department of Corrections and Rehabilitation',
    searchUrl: 'https://inmatelocator.cdcr.ca.gov/',
    apiAvailable: false,
  },
  'CO': {
    state: 'CO',
    stateName: 'Colorado',
    departmentName: 'Colorado Department of Corrections',
    searchUrl: 'https://www.colorado.gov/pacific/cdoc/offender-search',
    apiAvailable: false,
  },
  'CT': {
    state: 'CT',
    stateName: 'Connecticut',
    departmentName: 'Connecticut Department of Correction',
    searchUrl: 'https://portal.ct.gov/DOC/Common-Elements/Inmate-Information',
    apiAvailable: false,
  },
  'DE': {
    state: 'DE',
    stateName: 'Delaware',
    departmentName: 'Delaware Department of Correction',
    searchUrl: 'https://doc.delaware.gov/views/inmate.shtml',
    apiAvailable: false,
  },
  'FL': {
    state: 'FL',
    stateName: 'Florida',
    departmentName: 'Florida Department of Corrections',
    searchUrl: 'https://fdc.myflorida.com/OffenderSearch/',
    apiAvailable: false,
  },
  'GA': {
    state: 'GA',
    stateName: 'Georgia',
    departmentName: 'Georgia Department of Corrections',
    searchUrl: 'https://gdc.georgia.gov/offender-information/find-offender',
    apiAvailable: false,
  },
  'HI': {
    state: 'HI',
    stateName: 'Hawaii',
    departmentName: 'Hawaii Department of Corrections and Rehabilitation',
    searchUrl: 'https://dps.hawaii.gov/occc/offender-search/',
    apiAvailable: false,
  },
  'ID': {
    state: 'ID',
    stateName: 'Idaho',
    departmentName: 'Idaho Department of Correction',
    searchUrl: 'https://www.idoc.idaho.gov/content/prisons/offender_search',
    apiAvailable: false,
  },
  'IL': {
    state: 'IL',
    stateName: 'Illinois',
    departmentName: 'Illinois Department of Corrections',
    searchUrl: 'https://www.idoc.state.il.us/subsections/search/default.asp',
    apiAvailable: false,
  },
  'IN': {
    state: 'IN',
    stateName: 'Indiana',
    departmentName: 'Indiana Department of Correction',
    searchUrl: 'https://www.in.gov/idoc/offender-locator/',
    apiAvailable: false,
  },
  'IA': {
    state: 'IA',
    stateName: 'Iowa',
    departmentName: 'Iowa Department of Corrections',
    searchUrl: 'https://doc.iowa.gov/offender-information',
    apiAvailable: false,
  },
  'KS': {
    state: 'KS',
    stateName: 'Kansas',
    departmentName: 'Kansas Department of Corrections',
    searchUrl: 'https://kdocrepository.doc.ks.gov/kasper/',
    apiAvailable: false,
  },
  'KY': {
    state: 'KY',
    stateName: 'Kentucky',
    departmentName: 'Kentucky Department of Corrections',
    searchUrl: 'https://corrections.ky.gov/Facilities/Pages/Inmate-Search.aspx',
    apiAvailable: false,
  },
  'LA': {
    state: 'LA',
    stateName: 'Louisiana',
    departmentName: 'Louisiana Department of Public Safety and Corrections',
    searchUrl: 'https://doc.louisiana.gov/imprisoned-person-locator/',
    apiAvailable: false,
  },
  'ME': {
    state: 'ME',
    stateName: 'Maine',
    departmentName: 'Maine Department of Corrections',
    searchUrl: 'https://www.maine.gov/corrections/',
    apiAvailable: false,
  },
  'MD': {
    state: 'MD',
    stateName: 'Maryland',
    departmentName: 'Maryland Department of Public Safety and Correctional Services',
    searchUrl: 'https://www.dpscs.state.md.us/inmate/',
    apiAvailable: false,
  },
  'MA': {
    state: 'MA',
    stateName: 'Massachusetts',
    departmentName: 'Massachusetts Department of Correction',
    searchUrl: 'https://www.mass.gov/lists/doc-inmate-look-up',
    apiAvailable: false,
  },
  'MI': {
    state: 'MI',
    stateName: 'Michigan',
    departmentName: 'Michigan Department of Corrections',
    searchUrl: 'https://mdocweb.state.mi.us/otis2/otis2.aspx',
    apiAvailable: false,
  },
  'MN': {
    state: 'MN',
    stateName: 'Minnesota',
    departmentName: 'Minnesota Department of Corrections',
    searchUrl: 'https://coms.doc.state.mn.us/PublicViewer/',
    apiAvailable: false,
  },
  'MS': {
    state: 'MS',
    stateName: 'Mississippi',
    departmentName: 'Mississippi Department of Corrections',
    searchUrl: 'https://www.mdoc.ms.gov/inmate-information/inmate-search',
    apiAvailable: false,
  },
  'MO': {
    state: 'MO',
    stateName: 'Missouri',
    departmentName: 'Missouri Department of Corrections',
    searchUrl: 'https://doc.mo.gov/offender-search-and-victim-notification',
    apiAvailable: false,
  },
  'MT': {
    state: 'MT',
    stateName: 'Montana',
    departmentName: 'Montana Department of Corrections',
    searchUrl: 'https://cor.mt.gov/victimservices/offsearch',
    apiAvailable: false,
  },
  'NE': {
    state: 'NE',
    stateName: 'Nebraska',
    departmentName: 'Nebraska Department of Correctional Services',
    searchUrl: 'https://dcs-inmatesearch.ne.gov/Corrections/InmateDisplayInquiry.aspx',
    apiAvailable: false,
  },
  'NV': {
    state: 'NV',
    stateName: 'Nevada',
    departmentName: 'Nevada Department of Corrections',
    searchUrl: 'https://ofdsearch.doc.nv.gov/',
    apiAvailable: false,
  },
  'NH': {
    state: 'NH',
    stateName: 'New Hampshire',
    departmentName: 'New Hampshire Department of Corrections',
    searchUrl: 'https://www.nh.gov/nhdoc/divisions/field/victim.html',
    apiAvailable: false,
  },
  'NJ': {
    state: 'NJ',
    stateName: 'New Jersey',
    departmentName: 'New Jersey Department of Corrections',
    searchUrl: 'https://www.state.nj.us/corrections/pages/index.shtml',
    apiAvailable: false,
  },
  'NM': {
    state: 'NM',
    stateName: 'New Mexico',
    departmentName: 'New Mexico Corrections Department',
    searchUrl: 'https://cd.nm.gov/divisions/adult-prisons/inmate-search/',
    apiAvailable: false,
  },
  'NY': {
    state: 'NY',
    stateName: 'New York',
    departmentName: 'New York State Department of Corrections and Community Supervision',
    searchUrl: 'https://nysdoccslookup.doccs.ny.gov/',
    apiAvailable: false,
  },
  'NC': {
    state: 'NC',
    stateName: 'North Carolina',
    departmentName: 'North Carolina Department of Adult Correction',
    searchUrl: 'https://webapps.doc.state.nc.us/opi/offendersearch.do',
    apiAvailable: false,
  },
  'ND': {
    state: 'ND',
    stateName: 'North Dakota',
    departmentName: 'North Dakota Department of Corrections and Rehabilitation',
    searchUrl: 'https://www.docr.nd.gov/offender-locator',
    apiAvailable: false,
  },
  'OH': {
    state: 'OH',
    stateName: 'Ohio',
    departmentName: 'Ohio Department of Rehabilitation and Correction',
    searchUrl: 'https://appgateway.drc.ohio.gov/OffenderSearch',
    apiAvailable: false,
  },
  'OK': {
    state: 'OK',
    stateName: 'Oklahoma',
    departmentName: 'Oklahoma Department of Corrections',
    searchUrl: 'https://okoffender.doc.ok.gov/',
    apiAvailable: false,
  },
  'OR': {
    state: 'OR',
    stateName: 'Oregon',
    departmentName: 'Oregon Department of Corrections',
    searchUrl: 'https://docpub.state.or.us/OOS/intro.jsf',
    apiAvailable: false,
  },
  'PA': {
    state: 'PA',
    stateName: 'Pennsylvania',
    departmentName: 'Pennsylvania Department of Corrections',
    searchUrl: 'https://inmatelocator.cor.pa.gov/',
    apiAvailable: false,
  },
  'RI': {
    state: 'RI',
    stateName: 'Rhode Island',
    departmentName: 'Rhode Island Department of Corrections',
    searchUrl: 'https://www.doc.ri.gov/rehabilitative-services/offender-search',
    apiAvailable: false,
  },
  'SC': {
    state: 'SC',
    stateName: 'South Carolina',
    departmentName: 'South Carolina Department of Corrections',
    searchUrl: 'https://www.dc.state.sc.us/inmates.html',
    apiAvailable: false,
  },
  'SD': {
    state: 'SD',
    stateName: 'South Dakota',
    departmentName: 'South Dakota Department of Corrections',
    searchUrl: 'https://doc.sd.gov/adult/lookup/default.aspx',
    apiAvailable: false,
  },
  'TN': {
    state: 'TN',
    stateName: 'Tennessee',
    departmentName: 'Tennessee Department of Correction',
    searchUrl: 'https://www.tn.gov/correction/statistics-and-information/felony-offender-information.html',
    apiAvailable: false,
  },
  'TX': {
    state: 'TX',
    stateName: 'Texas',
    departmentName: 'Texas Department of Criminal Justice',
    searchUrl: 'https://inmate.tdcj.texas.gov/InmateSearch/start.action',
    apiAvailable: false,
  },
  'UT': {
    state: 'UT',
    stateName: 'Utah',
    departmentName: 'Utah Department of Corrections',
    searchUrl: 'https://corrections.utah.gov/offender-search/',
    apiAvailable: false,
  },
  'VT': {
    state: 'VT',
    stateName: 'Vermont',
    departmentName: 'Vermont Department of Corrections',
    searchUrl: 'https://doc.vermont.gov/about/inmate-programs-and-services',
    apiAvailable: false,
  },
  'VA': {
    state: 'VA',
    stateName: 'Virginia',
    departmentName: 'Virginia Department of Corrections',
    searchUrl: 'https://vadoc.virginia.gov/offenders/offender-locator/',
    apiAvailable: false,
  },
  'WA': {
    state: 'WA',
    stateName: 'Washington',
    departmentName: 'Washington State Department of Corrections',
    searchUrl: 'https://www.doc.wa.gov/information/inmate-search/',
    apiAvailable: false,
  },
  'WV': {
    state: 'WV',
    stateName: 'West Virginia',
    departmentName: 'West Virginia Division of Corrections and Rehabilitation',
    searchUrl: 'https://dcr.wv.gov/resources/Pages/offender-search.aspx',
    apiAvailable: false,
  },
  'WI': {
    state: 'WI',
    stateName: 'Wisconsin',
    departmentName: 'Wisconsin Department of Corrections',
    searchUrl: 'https://appsdoc.wi.gov/lop/',
    apiAvailable: false,
  },
  'WY': {
    state: 'WY',
    stateName: 'Wyoming',
    departmentName: 'Wyoming Department of Corrections',
    searchUrl: 'https://corrections.wyo.gov/residents-home/offender-locator',
    apiAvailable: false,
  },
  'DC': {
    state: 'DC',
    stateName: 'District of Columbia',
    departmentName: 'Federal Bureau of Prisons (BOP)',
    searchUrl: 'https://www.bop.gov/inmateloc/',
    apiAvailable: false,
    notes: 'DC felons are housed in federal facilities',
  },
};

/**
 * Get state corrections info
 */
export function getStateCorrectionsInfo(stateCode: string): StateCorrectionsInfo | null {
  return STATE_CORRECTIONS[stateCode.toUpperCase()] || null;
}

/**
 * Get all state corrections info
 */
export function getAllStateCorrectionsInfo(): StateCorrectionsInfo[] {
  return Object.values(STATE_CORRECTIONS);
}
