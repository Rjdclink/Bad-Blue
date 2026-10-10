# Public-place acquisition path

The deployed museum test retrieved 22 of 40 page selections but produced no
map candidate. The existing regional inference path expects a personal name
and residence statements, not a venue address.

This change adds an explicit “Locate a public venue (city-level)” option and
an authenticated `/api/spectra/public-place` route. One focused search supplies
up to eight public page URLs; supplied visitor-page URLs are prioritized. Page
retrieval receives its own budget. The existing public-URL restrictions apply.

The parser requires matching venue-name tokens in the fetched page title and
a visible address block containing a street and US postal city/state/ZIP.
Footer addresses and prose are excluded. Conflicting cities cause abstention.
The geocoder maps the supported city as labeled regional context. It is never
added to a person/device timeline and has no invented confidence probability.
The interface exposes fetched source links and their assessment outcomes.

Limitations: this is US city-level venue context, not an exact venue pin,
person-location inference, automatic photo acquisition, or an account/device
feed. Aliases, JSON-LD-only addresses, non-US addresses and pages without an
explicit address block may abstain. Failed retrievals remain reflected in the
selected/retrieved counts. Public-place results are transient, not saved sessions.

Validation: the new fixture pipeline tests pass, including source identity,
footer exclusion, conflicting addresses, geocoder failures and abstention.
The saved official Smithsonian visit page parses as Washington, DC. The full
Spectra verification suite, connection checks, focused module typecheck,
Vite compilation and server compilation pass. Full npm build is locally
blocked by an unrelated prebuild tsx IPC socket (EPERM); its production gate
is unchanged. Direct local network retrieval returned no page, so a deployed
browser test remains necessary before claiming live end-to-end success.
