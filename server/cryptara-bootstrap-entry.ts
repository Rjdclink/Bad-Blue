// Production entrypoint.
//
// CryptoCrawler is an operator-controlled subsystem. Process boot may load the
// application, but it must not probe CryptoCrawler Supabase, start Overflow
// workers, install observers, verify CryptoCrawler schema, or start market/RPC
// activity. The authenticated CryptoCrawler dashboard Master Power control is the
// sole lifecycle-entry authority.
process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'false';
process.env.CRYPTOCRAWLER_MANUAL_POWER_PHASE = 'OFF';

console.log(
  '[CRYPTARA][MANUAL-POWER] CryptoCrawler bootstrap deferred; Master Power OFF; zero CryptoCrawler database/network startup I/O',
);

await import('./index.js');
