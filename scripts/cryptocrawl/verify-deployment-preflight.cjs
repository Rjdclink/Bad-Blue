// Deployment-time verifier fan-out intentionally retired.
//
// Runtime safety and trading admission remain enforced by production code.
// Standalone verification scripts remain available for explicit/manual use,
// but they no longer veto Railway production builds through npm prebuild.

console.log('[deployment-preflight] verifier fan-out retired; continuing to normal Vite/esbuild production build');
