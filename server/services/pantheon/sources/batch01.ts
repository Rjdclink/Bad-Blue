/**
 * Pantheon verified source registry — batch 01.
 * 200 distinct public authority endpoints, grouped as 50 state courts,
 * 50 state corrections agencies, 50 state election/disclosure offices,
 * and 50 attorney licensing/discipline authorities.
 * Verification basis (2026-09-20): USAGov/DOJ/FEC/Iowa Judicial Branch directories.
 */
export interface PantheonVerifiedSource {
  id: string;
  name: string;
  url: string;
  jurisdiction: string;
  categories: string[];
  authority: 'primary'|'secondary';
  verifiedAt: string;
}
const V='2026-09-20';
const states=['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const names=['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];

const courtUrls=[
'https://judicial.alabama.gov/','https://courts.alaska.gov/','https://www.azcourts.gov/','https://courts.arkansas.gov/','https://www.courts.ca.gov/','https://www.courts.state.co.us/','https://www.jud.ct.gov/','https://courts.delaware.gov/','https://www.flcourts.gov/','https://georgiacourts.gov/','https://www.courts.state.hi.us/','https://isc.idaho.gov/','https://www.illinoiscourts.gov/','https://www.in.gov/courts/','https://www.iowacourts.gov/','https://www.kscourts.org/','https://www.kycourts.gov/','https://www.lasc.org/','https://www.courts.maine.gov/','https://www.courts.state.md.us/','https://www.mass.gov/orgs/massachusetts-court-system','https://www.courts.michigan.gov/','https://www.mncourts.gov/','https://courts.ms.gov/','https://www.courts.mo.gov/','https://courts.mt.gov/','https://supremecourt.nebraska.gov/','https://nvcourts.gov/','https://www.courts.nh.gov/','https://www.njcourts.gov/','https://www.nmcourts.gov/','https://ww2.nycourts.gov/','https://www.nccourts.gov/','https://www.ndcourts.gov/','https://www.supremecourt.ohio.gov/','https://www.oscn.net/','https://www.courts.oregon.gov/','https://www.pacourts.us/','https://www.courts.ri.gov/','https://www.sccourts.org/','https://ujs.sd.gov/','https://www.tncourts.gov/','https://www.txcourts.gov/','https://www.utcourts.gov/','https://www.vermontjudiciary.org/','https://www.vacourts.gov/','https://www.courts.wa.gov/','https://www.courtswv.gov/','https://www.wicourts.gov/','https://www.wyocourts.gov/'
];

const correctionsUrls=[
'https://doc.alabama.gov/','https://doc.alaska.gov/','https://corrections.az.gov/','https://doc.arkansas.gov/','https://www.cdcr.ca.gov/','https://cdoc.colorado.gov/','https://portal.ct.gov/doc','https://doc.delaware.gov/','https://fdc.myflorida.com/','https://gdc.georgia.gov/','https://dcr.hawaii.gov/','https://www.idoc.idaho.gov/','https://idoc.illinois.gov/','https://www.in.gov/idoc/','https://doc.iowa.gov/','https://www.doc.ks.gov/','https://corrections.ky.gov/','https://doc.louisiana.gov/','https://www.maine.gov/corrections/','https://dpscs.maryland.gov/','https://www.mass.gov/orgs/massachusetts-department-of-correction','https://www.michigan.gov/corrections','https://mn.gov/doc/','https://www.mdoc.ms.gov/','https://doc.mo.gov/','https://cor.mt.gov/','https://corrections.nebraska.gov/','https://doc.nv.gov/','https://www.corrections.nh.gov/','https://www.nj.gov/corrections/','https://www.cd.nm.gov/','https://doccs.ny.gov/','https://www.dac.nc.gov/','https://www.docr.nd.gov/','https://drc.ohio.gov/','https://oklahoma.gov/doc.html','https://www.oregon.gov/doc/','https://www.pa.gov/agencies/cor.html','https://doc.ri.gov/','https://www.doc.sc.gov/','https://doc.sd.gov/','https://www.tn.gov/correction.html','https://www.tdcj.texas.gov/','https://corrections.utah.gov/','https://doc.vermont.gov/','https://vadoc.virginia.gov/','https://www.doc.wa.gov/','https://dcr.wv.gov/','https://doc.wi.gov/','https://corrections.wyo.gov/'
];

const electionUrls=[
'https://www.sos.alabama.gov/alabama-votes','https://www.elections.alaska.gov/','https://azsos.gov/elections','https://www.sos.arkansas.gov/elections','https://www.sos.ca.gov/elections','https://www.sos.state.co.us/pubs/elections/main.html','https://portal.ct.gov/sots/election-services/election-services','https://elections.delaware.gov/','https://dos.fl.gov/elections/','https://sos.ga.gov/elections','https://elections.hawaii.gov/','https://sos.idaho.gov/elections-division/','https://www.elections.il.gov/','https://www.in.gov/sos/elections/','https://sos.iowa.gov/elections/','https://sos.ks.gov/elections/','https://elect.ky.gov/','https://www.sos.la.gov/ElectionsAndVoting/Pages/default.aspx','https://www.maine.gov/sos/cec/elec/','https://elections.maryland.gov/','https://www.sec.state.ma.us/divisions/elections/','https://www.michigan.gov/sos/elections','https://www.sos.state.mn.us/elections-voting/','https://www.sos.ms.gov/elections-voting','https://www.sos.mo.gov/elections/','https://sosmt.gov/elections/','https://sos.nebraska.gov/elections','https://www.nvsos.gov/sos/elections','https://www.sos.nh.gov/elections','https://www.nj.gov/state/elections/','https://www.sos.nm.gov/voting-and-elections/','https://elections.ny.gov/','https://www.ncsbe.gov/','https://www.sos.nd.gov/elections','https://www.ohiosos.gov/elections/','https://oklahoma.gov/elections.html','https://sos.oregon.gov/voting-elections/Pages/default.aspx','https://www.pa.gov/agencies/vote.html','https://vote.sos.ri.gov/','https://scvotes.gov/','https://sdsos.gov/elections-voting/','https://sos.tn.gov/elections','https://www.sos.state.tx.us/elections/','https://vote.utah.gov/','https://sos.vermont.gov/elections/','https://www.elections.virginia.gov/','https://www.sos.wa.gov/elections/','https://sos.wv.gov/elections/','https://elections.wi.gov/','https://sos.wyo.gov/Elections/'
];

const licenseUrls=[
'https://www.alabar.org/','https://alaskabar.org/','https://www.azbar.org/','https://attorneyinfo.aoc.arkansas.gov/','https://members.calbar.ca.gov/','https://www.coloradosupremecourt.com/','https://www.jud.ct.gov/attorneys.htm','https://courts.delaware.gov/odc/','https://www.floridabar.org/','https://www.gabar.org/','https://hsba.org/','https://isb.idaho.gov/','https://www.iardc.org/','https://courtapps.in.gov/rollofattorneys/','https://www.iacourtcommissions.org/','https://www.kscourts.org/Attorneys','https://www.kybar.org/','https://www.lsba.org/','https://www1.maine.gov/online/attorneysearch/','https://www.courts.state.md.us/attysearch','https://www.massbbo.org/','https://www.michbar.org/','https://mars.courts.state.mn.us/','https://courts.ms.gov/bar/baradmissions.php','https://www.mobar.org/','https://www.montanabar.org/','https://www.nebar.com/','https://www.nvbar.org/','https://www.nhbar.org/','https://portal.njcourts.gov/webe5/AttorneyInformationWebApp/','https://www.nmbar.org/','https://iapps.courts.state.ny.us/attorneyservices/search','https://www.ncbar.gov/','https://www.ndcourts.gov/lawyers','https://www.supremecourt.ohio.gov/attorneys/','https://www.okbar.org/','https://www.osbar.org/','https://www.padisciplinaryboard.org/','https://rijrs.courts.ri.gov/rijrs/attorney.do','https://www.scbar.org/','https://www.statebarofsouthdakota.com/','https://www.tbpr.org/','https://www.texasbar.com/','https://services.utahbar.org/','https://www.vermontjudiciary.org/attorneys','https://member.vsb.org/','https://www.mywsba.org/','https://www.mywvbar.org/','https://lawyerhistory.wicourts.gov/','https://www.wyomingbar.org/'
];

function group(prefix:string, urls:string[], cats:string[], label:string):PantheonVerifiedSource[]{
 return urls.map((url,i)=>({id:`b01-${prefix}-${states[i].toLowerCase()}`,name:`${names[i]} ${label}`,url,jurisdiction:`US-${states[i]}`,categories:cats,authority:'primary',verifiedAt:V}));
}
export const PANTHEON_VERIFIED_SOURCES_BATCH_01:PantheonVerifiedSource[]=[
 ...group('court',courtUrls,['courts','civil-litigation','criminal','family-probate','estate'],'Judiciary'),
 ...group('doc',correctionsUrls,['corrections','criminal','probation-parole'],'Department of Corrections'),
 ...group('election',electionUrls,['campaign-finance','government-employment','organizations'],'Election/Disclosure Office'),
 ...group('license',licenseUrls,['credentials','professional-discipline','professional-web'],'Attorney Licensing Authority'),
];
if(PANTHEON_VERIFIED_SOURCES_BATCH_01.length!==200) throw new Error('Pantheon batch 01 must contain exactly 200 sources');
