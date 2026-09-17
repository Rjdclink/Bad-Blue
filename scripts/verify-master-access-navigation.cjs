const fs = require("node:fs");
const path = require("node:path");

function read(relative) {
  return fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const app = read("client/src/App.tsx");
const navigator = read("client/src/components/MasterPanelNavigator.tsx");
const avatar = read("client/src/components/LexaraEtherealAvatar.tsx");
const login = read("client/src/pages/login.tsx");
const auth = read("server/auth.ts");
const master = read("server/masterPassword.ts");

const appRoutes = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => match[1]));
const panelPaths = [...navigator.matchAll(/\{\s*label:\s*'[^']+',\s*path:\s*'([^']+)'/g)].map(match => match[1]);
const panelSet = new Set(panelPaths);

assert(panelPaths.length === panelSet.size, "Master panel navigator contains duplicate canonical paths");
assert(panelPaths[0] === "/welcome", "Master traversal must start on LegalWhat /welcome");
assert(navigator.includes("% MASTER_PANELS.length"), "Master panel Back/Forward traversal must wrap around");
assert(navigator.includes("aria-label=\"Previous master panel\""), "Master Back button is missing");
assert(navigator.includes("aria-label=\"Next master panel\""), "Master Forward button is missing");
assert(navigator.includes("aria-label=\"Log out\""), "Master Logout button is missing");
assert(navigator.indexOf('aria-label="Log out"') > navigator.indexOf('aria-label="Next master panel"'), "Logout must remain beneath/after Forward");

for (const panelPath of panelPaths) {
  assert(appRoutes.has(panelPath), `Master panel route is not registered in App.tsx: ${panelPath}`);
}

const adminRoutes = [...appRoutes].filter(route => route.startsWith("/admin-"));
for (const route of adminRoutes) {
  assert(panelSet.has(route), `Administrative route omitted from master traversal: ${route}`);
}

const requiredSurfaces = [
  "/administrator",
  "/dashboard",
  "/cryptocrawler-v2",
  "/cryptocrawler-dashboard",
  "/orchestrator-console",
  "/control-room",
  "/pantheon",
  "/spectra",
  "/geoconsole",
  "/geoconsole-command",
  "/geoconsole-process",
  "/geoconsole-report",
  "/location-intel",
  "/tshpe-locator",
];
for (const route of requiredSurfaces) {
  assert(panelSet.has(route), `Required master surface omitted: ${route}`);
}

assert(app.includes("enabled: isAuthenticated && !isMasterSession"), "Master session must disable custom swipe navigation");
assert(app.includes('body.style.touchAction = "pan-y pinch-zoom"'), "Master mobile shell must preserve vertical scrolling and pinch zoom");
assert(app.includes('body.style.overscrollBehaviorX = "none"'), "Master shell must suppress horizontal browser overscroll navigation");

assert(avatar.includes('src="/images/oip.webp"'), "LEXARA attorney image is not reinstated");
assert(!avatar.includes("<svg"), "Retired ethereal SVG is still rendered");

assert(login.includes('"/api/master-login"'), "Master login UI is not using the canonical password-only endpoint");
assert(!/master[^\n]{0,80}email/i.test(login), "Master login UI appears to require an email");
assert(auth.includes('app.post("/api/master-login"'), "Canonical master login endpoint is missing");
assert(auth.includes('app.post("/api/local-login"'), "Canonical local login endpoint is missing");
assert(auth.includes('app.post("/api/local-register"'), "Canonical local registration endpoint is missing");
assert(auth.includes('app.get("/api/auth/ready"'), "Local auth readiness endpoint is missing");
assert(master.includes("process.env.MASTER_ADMIN_PASSWORD"), "Master password must come from the deployment secret");
assert(!master.includes("MASTER_PASSWORD_SHA256"), "Reusable master verifier must not be committed to source");

console.log(`Master access/navigation verification passed: ${panelPaths.length} master panels, ${adminRoutes.length} admin routes.`);
