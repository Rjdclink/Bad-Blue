const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function must(condition, message) {
  if (!condition) {
    console.error(`[seo-branding] FAIL: ${message}`);
    process.exit(1);
  }
}

function mustNot(content, needle, message) {
  must(!content.includes(needle), message);
}

const index = read('client/index.html');
const seoHead = read('client/src/components/SEOHead.tsx');
const seoConfig = read('shared/seoConfig.ts');
const landing = read('client/src/pages/landing.tsx');
const manifest = read('public/manifest.json');
const robots = read('public/robots.txt');
const sitemap = read('public/sitemap.xml');
const llms = read('public/llms.txt');
const serverIndex = read('server/index.ts');

must(fs.existsSync('public/images/Legal What Icon.png'), 'Legal What brand icon must exist');
must(index.includes('<title>Legal What? |'), 'root title must use Legal What?');
must(index.includes('https://legalwhat.com/'), 'root canonical must use legalwhat.com');
must(index.includes('/images/Legal%20What%20Icon.png'), 'root favicon/social image must use Legal What icon');
mustNot(index, 'https://example.com', 'root metadata must not use example.com');
mustNot(index, 'BadBlue', 'root metadata must not use BadBlue');
mustNot(index, 'Bad Blue', 'root metadata must not use Bad Blue');
mustNot(index, '<meta name="keywords"', 'root must not emit meta-keywords');
mustNot(index, '"aggregateRating"', 'root must not emit unverified aggregate rating markup');
must(index.includes('"email": "contact.badblue@gmail.com"'), 'organization schema must expose the support email');
must(index.includes('Try LegalWhat free for 3 days, then only $19.99/month.'), 'root metadata must expose canonical 3-day free trial and $19.99/month positioning');
must(index.includes('"price": "19.99"') && index.includes('"priceCurrency": "USD"'), 'root application schema must expose the canonical monthly offer price');
for (const capability of ['Visible animated AI', 'DOCX and PDF', 'Uploaded document, evidence, image, and media analysis', 'Intuitive legal-document recognition and preparation']) {
  must(index.includes(capability), `root metadata/schema must expose Lexara capability: ${capability}`);
}
const lexaraSeoPage = read('public/services/ai-legal-consultation/index.html');
for (const capability of ['animated conversational legal AI', '40+ areas of law', 'PDF or DOCX', 'Upload documents, evidence, images, and other media']) {
  must(lexaraSeoPage.includes(capability), `Lexara crawlable page must expose capability: ${capability}`);
}

must(seoHead.includes('const BASE_URL = "https://legalwhat.com"'), 'SEOHead base URL must be legalwhat.com');
must(seoHead.includes('const SITE_NAME = "Legal What?"'), 'SEOHead site name must be Legal What?');
must(seoHead.includes('script#page-schema'), 'page schema must have isolated script authority');
must(seoHead.includes('removeMetaTag("keywords")'), 'SEOHead must suppress meta-keywords');
must(seoHead.includes('const effectiveNoIndex = noIndex || isPrivateRoute(path)'), 'SEOHead must centrally noindex protected routes');
must(seoHead.includes('"/people-finder"') && seoHead.includes('"/inmate-locator"'), 'people finder and inmate tools must remain protected from indexing');
mustNot(seoHead, 'https://example.com', 'SEOHead must not use example.com');
mustNot(seoHead, '@BadBlueApp', 'SEOHead must not restore legacy social handle');

must(seoConfig.includes('export const BASE_URL = "https://legalwhat.com"'), 'central SEO base URL must be legalwhat.com');
must(seoConfig.includes('export const SITE_NAME = "Legal What?"'), 'central SEO site name must be Legal What?');
must(seoConfig.includes('"/legal-consultation": {'), 'public legal consultation route must have SEO config');
for (const privatePath of ['/officer', '/complaint-form', '/lawsuit-form', '/foia-request-form', '/petitions', '/evidence-hub']) {
  const marker = `  "${privatePath}": {`;
  const start = seoConfig.indexOf(marker);
  must(start >= 0, `SEO config missing ${privatePath}`);
  const next = seoConfig.indexOf('\n  "/', start + marker.length);
  const block = seoConfig.slice(start, next >= 0 ? next : seoConfig.indexOf('\n};', start));
  must(block.includes('noIndex: true'), `${privatePath} must be noindex in SEO config`);
  must(block.includes('includeInSitemap: false'), `${privatePath} must be excluded from sitemap`);
}

must(manifest.includes('"name": "Legal What? - AI Legal Platform"'), 'manifest must use Legal What?');
must(manifest.includes('/images/Legal%20What%20Icon.png'), 'manifest must use Legal What icon');
mustNot(manifest, 'Bad Blue', 'manifest must not use legacy brand');
mustNot(manifest, 'BadBlue', 'manifest must not use legacy brand');
mustNot(manifest, 'example.com', 'manifest must not use example.com');

must(robots.includes('Sitemap: https://legalwhat.com/sitemap.xml'), 'robots must advertise canonical sitemap');
must(robots.includes('Disallow: /api/'), 'robots must block API surface');
mustNot(robots, 'Disallow: /login', 'robots must allow crawling so login noindex can be read');
mustNot(robots, 'Disallow: /complaint-form', 'robots must allow protected-page noindex directives to be read');
mustNot(robots, 'BadBlue', 'robots must not use legacy brand');
mustNot(robots, 'Bad Blue', 'robots must not use legacy brand');
mustNot(robots, 'example.com', 'robots must not use example.com');

for (const publicPath of ['https://legalwhat.com/', 'https://legalwhat.com/legal-consultation', 'https://legalwhat.com/faq', 'https://legalwhat.com/contact', 'https://legalwhat.com/privacy', 'https://legalwhat.com/terms']) {
  must(sitemap.includes(`<loc>${publicPath}</loc>`), `static sitemap missing ${publicPath}`);
}
mustNot(sitemap, 'https://legalwhat.com/landing', 'duplicate /landing URL must stay out of sitemap');
mustNot(sitemap, 'example.com', 'sitemap must not use example.com');
mustNot(sitemap, 'BadBlue', 'sitemap must not use legacy brand');
mustNot(sitemap, 'Bad Blue', 'sitemap must not use legacy brand');
mustNot(sitemap, '<lastmod>', 'static sitemap must not emit synthetic freshness dates');
for (const inactiveUrl of ['https://legalwhat.com/services/background-report/', 'https://legalwhat.com/services/people-finder/', 'https://legalwhat.com/services/inmate-locator/']) {
  mustNot(sitemap, inactiveUrl, `static sitemap must not promote inactive service: ${inactiveUrl}`);
}
const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
must(new Set(sitemapLocs).size === sitemapLocs.length, 'static sitemap must not contain duplicate URLs');

must(llms.includes('# Legal What?'), 'llms.txt must identify Legal What?');
must(llms.includes('40+ areas of law'), 'llms.txt must accurately describe Lexara legal-area coverage');
must(llms.includes('https://legalwhat.com/sitemap.xml'), 'llms.txt must reference the canonical sitemap');
mustNot(llms, '31 practice areas', 'llms.txt must not restore the obsolete 31-area count');
mustNot(llms, 'API Access for Developers', 'llms.txt must not advertise unverified developer API access');
mustNot(index, 'People finder and geolocation intelligence tools', 'root schema must not advertise inactive people finder');
mustNot(index, 'Nationwide inmate locator', 'root schema must not advertise inactive inmate search');
mustNot(llms, '[People finder]', 'llms.txt must not advertise inactive people finder');
mustNot(llms, '[Inmate locator]', 'llms.txt must not advertise inactive inmate search');

must(serverIndex.includes('staticSitemap.matchAll') && serverIndex.includes('staticUrls') && serverIndex.includes('new Set([...canonicalPaths, ...staticUrls])'), 'live sitemap must merge the expanded static crawl inventory with canonical SPA routes');
must(serverIndex.includes('Do not emit synthetic freshness'), 'dynamic sitemap must not fabricate lastmod freshness');

for (const phrase of [
  'Legal What? — AI Legal Tools for 40 Practice Areas',
  'Lexara is a jurisdiction-aware conversational legal AI with extensive knowledge across 40+ areas of law.',
]) {
  must(landing.includes(phrase), `landing must describe capability: ${phrase}`);
}
must(landing.includes('/images/Legal%20What%20Icon.png'), 'landing must use Legal What icon');
must(landing.includes('LAW_TYPE_DATA.map((area)'), 'landing must expose the 40 legal practice areas as crawlable content');
mustNot(landing, 'facebook.com/badblue', 'landing must not link legacy social profiles');
mustNot(landing, 'twitter.com/badblue', 'landing must not link legacy social profiles');
mustNot(landing, 'linkedin.com/company/badblue', 'landing must not link legacy social profiles');
mustNot(landing, 'BadBlue', 'landing must not use BadBlue');
mustNot(landing, 'Bad Blue', 'landing must not use Bad Blue');
mustNot(landing, 'https://example.com', 'landing must not use example.com');

for (const path of [
  'client/src/pages/complaint-form.tsx',
  'client/src/pages/lawsuit-form.tsx',
  'client/src/pages/foia-request-form.tsx',
  'client/src/pages/petitions.tsx',
  'client/src/pages/evidence-hub.tsx',
  'client/src/pages/officer.tsx',
  'client/src/pages/login.tsx',
]) {
  const page = read(path);
  must(page.includes('noIndex'), `${path} must explicitly noindex its protected workspace`);
  mustNot(page, 'canonicalUrl="https://example.com', `${path} must not use example.com canonical`);
}

for (const path of [
  'client/src/pages/contact.tsx',
  'client/src/pages/privacy.tsx',
  'client/src/pages/terms.tsx',
  'client/src/pages/faq.tsx',
]) {
  const page = read(path);
  mustNot(page, 'BadBlue', `${path} must not expose BadBlue branding`);
  mustNot(page, 'Bad Blue', `${path} must not expose Bad Blue branding`);
  mustNot(page, 'https://example.com', `${path} must not use example.com metadata`);
}

for (const section of ['areas', 'services']) {
  for (const entry of fs.readdirSync(`public/${section}`, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const publicPage = read(`public/${section}/${entry.name}/index.html`);
    must(publicPage.includes('contact.badblue@gmail.com'), `${section}/${entry.name} must expose support contact information`);
    if (section === 'areas') must(publicPage.includes('<h2>Common topics</h2>'), `areas/${entry.name} must contain substantive topic content`);
  }
}


const lawTypesSource = read('shared/lawTypes.ts');
const lawTypeIds = [...lawTypesSource.matchAll(/^\s+'([a-z0-9-]+)',\s*$/gm)].map((match) => match[1]);
must(lawTypeIds.length === 40, `expected exactly 40 canonical law-type IDs, found ${lawTypeIds.length}`);
must(new Set(lawTypeIds).size === 40, 'canonical law-type IDs must be unique');

const sitemapUrls = new Set(sitemapLocs);
for (const lawTypeId of lawTypeIds) {
  const relativePath = `public/areas/${lawTypeId}/index.html`;
  must(fs.existsSync(relativePath), `missing crawlable practice-area page: ${lawTypeId}`);
  const page = read(relativePath);
  const canonicalUrl = `https://legalwhat.com/areas/${lawTypeId}/`;
  must(page.includes('<title>') && page.includes('| LegalWhat</title>'), `${lawTypeId} must have a LegalWhat title`);
  const descriptionMatch = page.match(/<meta name="description" content="([^"]+)"/);
  must(Boolean(descriptionMatch?.[1]), `${lawTypeId} must have a meta description`);
  must((descriptionMatch?.[1]?.length || 0) <= 240, `${lawTypeId} meta description must remain bounded`);
  must(page.includes(`<link rel="canonical" href="${canonicalUrl}">`), `${lawTypeId} canonical URL mismatch`);
  must(page.includes('<meta name="robots" content="index,follow'), `${lawTypeId} must remain indexable`);
  must(page.includes('<script type="application/ld+json">'), `${lawTypeId} must expose structured data`);
  must(page.includes('<h1>'), `${lawTypeId} must contain an H1`);
  must(page.includes('<h2>Common topics</h2>'), `${lawTypeId} must contain substantive topic content`);
  must(page.includes('/legal-consultation'), `${lawTypeId} must internally link to legal consultation`);
  must(sitemapUrls.has(canonicalUrl), `sitemap missing practice-area canonical: ${canonicalUrl}`);
}

for (const requiredCrawlerFile of ['public/robots.txt', 'public/sitemap.xml', 'public/llms.txt']) {
  must(fs.existsSync(requiredCrawlerFile), `missing crawler file: ${requiredCrawlerFile}`);
}
must(robots.includes('User-agent: *') && robots.includes('Allow: /'), 'robots must keep public crawl access');
mustNot(robots, 'Disallow: /areas', 'robots must not block practice-area content');
mustNot(robots, 'Disallow: /services', 'robots must not block public service content');
must(llms.includes('[Practice areas](https://legalwhat.com/areas/)'), 'llms.txt must expose the practice-area hub');
must(llms.includes('[Services](https://legalwhat.com/services/)'), 'llms.txt must expose the services hub');
must(sitemapUrls.has('https://legalwhat.com/areas/'), 'sitemap must include practice-area hub');
must(sitemapUrls.has('https://legalwhat.com/services/'), 'sitemap must include services hub');


const searchArchitecture = read('shared/seoSearchArchitecture.json');
for (const phrase of [
  'conversational legal AI',
  'two-way conversational legal AI',
  'voice legal AI',
  'AI legal research assistant',
  'legal media analysis AI',
  'OSINT AI',
  'AI public records search',
  'AI legal document generator',
  'convenient legal AI',
  'affordable legal AI',
  'user-friendly legal AI',
  'flat-rate legal AI',
  '$19.99 legal AI subscription'
]) {
  must(searchArchitecture.includes(phrase), `search-intent architecture missing: ${phrase}`);
}
for (const hub of ['public/guides/index.html', 'public/documents/index.html']) {
  must(fs.existsSync(hub), `missing public discovery hub: ${hub}`);
}
for (const url of [
  'https://legalwhat.com/guides/',
  'https://legalwhat.com/documents/',
  'https://legalwhat.com/guides/talk-to-ai-about-legal-problem/',
  'https://legalwhat.com/guides/ai-legal-research-assistant/',
  'https://legalwhat.com/guides/ai-evidence-analysis/',
  'https://legalwhat.com/guides/osint-ai-legal-research/',
  'https://legalwhat.com/guides/federal-supervised-release-violation/',
  'https://legalwhat.com/guides/motion-to-suppress-evidence/',
  'https://legalwhat.com/documents/motion/',
  'https://legalwhat.com/documents/complaint/',
  'https://legalwhat.com/documents/contract/',
  'https://legalwhat.com/documents/habeas-petition/'
]) {
  must(sitemapUrls.has(url), `sitemap missing focused discovery URL: ${url}`);
}

console.log('[seo-branding] PASS: Legal What SEO, crawl, canonical, schema, content-depth, contact, and brand invariants verified');
