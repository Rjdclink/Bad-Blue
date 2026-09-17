const fs = require('fs');
const path = require('path');

const appPath = path.resolve('client/src/App.tsx');
const navigatorPath = path.resolve('client/src/components/MasterPanelNavigator.tsx');
const avatarPath = path.resolve('client/src/components/LexaraEtherealAvatar.tsx');
const attorneyImagePath = path.resolve('public/images/oip.webp');

for (const required of [appPath, navigatorPath, avatarPath, attorneyImagePath]) {
  if (!fs.existsSync(required)) {
    throw new Error('Master access verification missing required file: ' + path.relative(process.cwd(), required));
  }
}

const app = fs.readFileSync(appPath, 'utf8');
const navigator = fs.readFileSync(navigatorPath, 'utf8');
const avatar = fs.readFileSync(avatarPath, 'utf8');

const panelArrayMatch = navigator.match(/export const MASTER_PANELS:[\s\S]*?= \[([\s\S]*?)\n\];/);
if (!panelArrayMatch) throw new Error('Unable to parse MASTER_PANELS registry');

const panelPaths = [...panelArrayMatch[1].matchAll(/\bpath:\s*['\"]([^'\"]+)['\"]/g)].map(match => match[1]);
if (panelPaths.length < 2) throw new Error('MASTER_PANELS must contain LegalWhat plus at least one master panel');
if (panelPaths[0] !== '/welcome') throw new Error('Master panel traversal must begin at /welcome');

const duplicatePaths = panelPaths.filter((panelPath, index) => panelPaths.indexOf(panelPath) !== index);
if (duplicatePaths.length) {
  throw new Error('Duplicate canonical master panel paths: ' + [...new Set(duplicatePaths)].join(', '));
}

const missingRoutes = panelPaths.filter(panelPath => !app.includes('<Route path="' + panelPath + '"'));
if (missingRoutes.length) {
  throw new Error('Master panels without App routes: ' + missingRoutes.join(', '));
}

if (!app.includes('enabled: isAuthenticated && !isMasterSession')) {
  throw new Error('Master sessions must disable global gesture navigation');
}
if (!app.includes('touchAction = "pan-y pinch-zoom"') || !app.includes('overscrollBehaviorX = "none"')) {
  throw new Error('Master shell is missing mobile scroll/overscroll protections');
}
if (!navigator.includes('(currentIndex + direction + MASTER_PANELS.length) % MASTER_PANELS.length')) {
  throw new Error('Master Back/Forward navigation must wrap around');
}
if (!navigator.includes("fetch('/api/auth/logout'") || !navigator.includes('LogOut')) {
  throw new Error('Master navigator must preserve Logout');
}
if (!avatar.includes('src="/images/oip.webp"')) {
  throw new Error('LEXARA must use the reinstated attorney image');
}

console.log('Master access verification passed: ' + panelPaths.length + ' canonical panels, wraparound navigation, mobile guard, logout, and attorney avatar.');
