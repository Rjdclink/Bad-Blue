import test from "node:test";
import assert from "node:assert/strict";
import { LEXARA_PUBLIC_SOURCES, getLexaraPublicSources, buildLexaraSourceQueries } from "../server/lexara/LexaraPublicSourceRegistry.ts";

const retained = [
  "cdc-vital-records","nursys-license","careeronestop-license-finder","ncsbn-license-verification",
  "cms-npi-registry","oig-leie","finra-brokercheck","ofac-sanctions","sec-edgar","sam-entity",
  "usaspending","irs-teos","courtlistener","bop-inmate-locator","usagov-corrections",
  "usagov-state-local","vinelink","census-geocoder","epa-echo","openfema","nhtsa-vpic",
  "uspto-patents","uspto-trademarks","icann-rdap","iana-rdap-bootstrap","cisa-advisories",
  "hibp-breach-directory","lookups-io","wikidata","wikidata-query","commoncrawl-index",
  "nsopw","pacer-court-records","fec-data","senate-lobbying","nmls-consumer-access",
];
const additions = [
  "vlex-fastcase","justia-case-law","findlaw-case-law","google-scholar-cases","govinfo",
  "congress-legislation","state-legislatures-directory","federal-courts","state-court-directory",
  "cornell-lii","ecfr","federal-register","caselaw-access-project","openjurist","leagle",
  "lawdiver","fdic-bankfind","netr-public-records","opencorporates",
  "wayback-machine","reuters","associated-press","nass-corporate-registration",
  "justice-press-releases","library-of-congress",
];
const byId = new Map(LEXARA_PUBLIC_SOURCES.map(source => [source.id, source]));

test("preserves every original source and adds the complete approved legal/background shortlist", () => {
  assert.equal(LEXARA_PUBLIC_SOURCES.length, retained.length + additions.length);
  for (const id of [...retained, ...additions]) assert.ok(byId.has(id), "missing "+id);
  assert.equal(new Set(LEXARA_PUBLIC_SOURCES.map(x => x.id)).size, LEXARA_PUBLIC_SOURCES.length);
  assert.deepEqual(LEXARA_PUBLIC_SOURCES.slice(0, retained.length).map(x => x.id), retained);
});
test("Fastcase is discoverable but cannot be treated as a free programmatic API", () => {
  const fastcase = byId.get("vlex-fastcase");
  assert.equal(fastcase.lookupMode, "interactive");
  assert.match(fastcase.root, /^https:\/\/us\.vlex\.com\/fastcase-library/);
  assert.equal(fastcase.authority, "secondary");
});
test("all added source roots are safe HTTPS addresses with no duplicate source identifiers", () => {
  for (const id of additions) {
    const source = byId.get(id);
    assert.equal(new URL(source.root).protocol, "https:");
    assert.ok(source.categories.length > 0 && source.queryHints.length > 0);
  }
});
test("new legal, records, finance and news source categories are selectable", () => {
  for (const [category, id] of [
    ["courts","justia-case-law"],["courts","cornell-lii"],["government-public","govinfo"],
    ["financial-public","fdic-bankfind"],["property","netr-public-records"],
    ["business","nass-corporate-registration"],["news-history","wayback-machine"],
    ["news-history","associated-press"],["government-public","congress-legislation"],
  ]) assert.ok(getLexaraPublicSources([category],"Iowa").some(x => x.id===id), category+" missing "+id);
});
test("named provider requests place public site discovery within the first two variants", () => {
  for (const [q,category,domain] of [
    ["Fastcase appellate opinions","courts","us.vlex.com"],
    ["Justia appellate opinions","courts","law.justia.com"],
    ["FindLaw case law","courts","caselaw.findlaw.com"],
    ["Google Scholar court opinions","courts","scholar.google.com"],
    ["GovInfo federal law","government-public","www.govinfo.gov"],
    ["Congress.gov legislation","government-public","www.congress.gov"],
    ["eCFR federal regulations","government-public","www.ecfr.gov"],
    ["Cornell LII legal rule","courts","www.law.cornell.edu"],
    ["LawDiver case search","courts","lawdiver.com"],
    ["FDIC BankFind bank charter","financial-public","banks.data.fdic.gov"],
    ["NETR county assessor deeds","property","publicrecords.netronline.com"],
    ["Wayback Machine old website","news-history","web.archive.org"],
    ["Associated Press news history","news-history","apnews.com"],
    ["NASS corporate registration","business","www.nass.org"],
  ]) {
    const queries=buildLexaraSourceQueries({query:q,categories:[category],jurisdiction:"Iowa"});
    assert.ok(queries.slice(0,2).some(x=>x.includes("site:"+domain)),q+": source not in first two search variants");
    assert.ok(queries.length<=6);
  }
});
test("explicitly named sites can be found before the legal category is known", () => {
  for (const [query, domain] of [["Check Fastcase for appellate law", "us.vlex.com"], ["Search GovInfo for rules", "www.govinfo.gov"], ["Check FDIC BankFind for banks", "banks.data.fdic.gov"]]) {
    const queries = buildLexaraSourceQueries({query, jurisdiction:"Iowa"});
    assert.ok(queries.slice(0,2).some(q => q.includes("site:"+domain)), query+" had no first-useful site search");
  }
});
test("every newly added source supports explicit public site discovery", () => {
  for (const id of additions) {
    const source=byId.get(id);
    const alias=source.searchAliases?.[0];
    assert.ok(alias && alias.length>=4,"missing safe source alias: "+id);
    const variants=buildLexaraSourceQueries({query:alias+" public research",jurisdiction:"Iowa"});
    assert.ok(variants.slice(0,2).some(q=>q.includes("site:"+new URL(source.root).hostname)),id+" not reachable during first-useful discovery");
  }
});
test("normal background discovery preserves its existing first two focused variants", () => {
  const query="Hello, please answer briefly: what business does Avery Morgan Example operate?";
  const queries=buildLexaraSourceQueries({
    query,subject:"Avery Morgan Example",requestedFact:"business",
    categories:["business"],jurisdiction:"Iowa",
  });
  assert.equal(queries[0],'"Avery Morgan Example" business Iowa');
  assert.equal(queries[1],"Avery Morgan Example business Iowa");
  assert.ok(!queries.slice(0,2).some(q=>q.includes("Hello")||q.includes("answer briefly")));
});
