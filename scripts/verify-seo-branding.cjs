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

must(serverIndex.includes('.map((config) => config.canonicalPath)'), 'dynamic sitemap must emit canonical paths');
must(serverIndex.includes('Do not emit synthetic freshness'), 'dynamic sitemap must not fabricate lastmod freshness');

for (const phrase of [
  'Legal What? — AI Legal Tools for 31 Practice Areas',
  'two-way voice or text consultation',
  'background report generation',
  'People Finder',
  'nationwide criminal inmate locator',
]) {
  must(landing.includes(phrase), `landing must describe capability: ${phrase}`);
}
must(landing.includes('/images/Legal%20What%20Icon.png'), 'landing must use Legal What icon');
must(landing.includes('LAW_TYPE_DATA.map((area)'), 'landing must expose the 31 legal practice areas as crawlable content');
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

console.log('[seo-branding] PASS: Legal What SEO, crawl, canonical, schema, and brand invariants verified');
