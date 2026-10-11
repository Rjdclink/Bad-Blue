# Spectra functional audit — 2026-10-08

## Finding

The production test using only the consenting account owner's name, email and
phone completed discovery across six source groups, but produced no timestamped
coordinate observation sufficient to place that person on the map. The address
provided separately as ground truth was excluded from all Spectra inputs.

The principal gap is acquisition of a fresh measurement associated with the
subject. A phone number can identify a search target; it does not expose that
phone's radio measurements. A location normalizer or solver cannot create a
measurement which its upstream source has not supplied. Direct GPS sharing is
not an architectural requirement: radio ranging or other spatial evidence can
provide the inputs, when available.

Twenty-five feet is 7.62 meters. A map coordinate with many decimal places is
not evidence of that accuracy, current presence, or subject identity.

## Trace through the repository

| Layer | Implementation | Observed behavior or gap |
| --- | --- | --- |
| Lexara launch | `client/src/components/LexaraConversation.tsx` | Hidden location commands launch Spectra before a paid chat request and carry the current command and bounded conversation context. |
| Spectra input | `client/src/pages/spectra.tsx` | Map is rendered immediately; clues, uploaded media and location exports enter separate acquisition paths. No private social-account or browser-history connection flow was found here. |
| Discovery | `server/routes/spectra.routes.ts` | Name/email/phone support public discovery queries. Device collectors receive a separately extracted device identifier. A phone clue alone is not an enrolled device identifier. |
| Active acquisition | `server/services/spectra/SpectraActiveAcquisition.ts` | Managed Android/Apple and Cisco collectors require configured HTTPS endpoints and credentials. Generic collectors require valid configuration and actual provider responses. |
| Adapter catalog | `server/services/spectra/SpectraAdapterRegistry.ts` | Catalog readiness includes parsers, importers and contextual sources. It does not establish that measurements are being received for a particular subject. |
| Ingest/persistence | `server/routes/geoconsole.routes.ts` | Authenticated observations are normalized, associated with a session, persisted where storage is available, and pushed to the session stream. Saving availability is returned separately from request success. |
| Runtime | `client/src/hooks/useGeoRuntime.ts` | Local observations render immediately. Previously, rapid first observations could publish before a canonical session ID existed; failed saving was concealed. |
| Media | `server/routes/gps.routes.ts` | Uploaded bytes supply metadata. Coordinate evidence requires both position and capture timestamp; metadata extraction is not proof that a person is currently at the capture point. |
| Location assessment | `server/services/spectra/` | Existing quality, identity, timestamp, correlation and uncertainty gates must be retained. Duplicate or stale clues must not manufacture precision. |

Production configuration reviewed during this audit did not contain Spectra
collector endpoints/tokens, a signed telemetry webhook secret, a ranging anchor
catalog, or configured generic active collectors. Opera's connector reported
that no browser was connected. The connected account's recent sign-in notice
contained device/account information, but no coordinate measurement. These are
source-availability findings, not estimates of the subject's position.

## Non-GPS paths and their actual inputs

| Path | Required input | Present gap |
| --- | --- | --- |
| Wi-Fi RTT / UWB / Bluetooth ranging | Fresh ranges or directions, reference coordinates and subject/device association | Existing normalizers and constraint solving need real measurements and anchors. |
| Wi-Fi / cellular positioning | Observed access-point or cell identifiers and signal data | Lookup adapters need observations; a telephone number is not a radio scan. |
| Carrier network location | An onboarded provider, authorized device access, returned region and measurement time | CAMARA response normalization is not a live carrier subscription; precision depends on the provider/network. |
| Original photo/video | Original file bytes, metadata or independently established scene location, capture time and subject association | Picker behavior can remove embedded GPS. An old photo establishes a historical capture point. |
| Downloaded location export | A supported JSON/GeoJSON/GPX/KML/CSV or other location export with observations | Imports exist; a generic downloaded file may contain no spatial information. |
| Connected account/browser activity | A functioning authorized connection and records containing useful spatial evidence | Signing in confirms identity; it does not itself disclose a live position. The available Opera connection was offline. |

The cloud test browser is not the account owner's physical device. Its own
location must not be attached to the account owner as a measurement.

## Repairs in this change

1. Preserve the original-file picker instead of the mobile `image/*` picker,
   which can strip embedded GPS metadata. Keep media and structured location
   file handlers and validation.
2. Serialize optional live observation publication so rapid initial fixes use
   one canonical investigation. Include its subject label and preserve immediate
   local rendering, provider accuracy and the existing confidence ceiling.
3. Display saving failures independently of geolocation errors. Clear them
   after successful persistence and ignore callbacks after watcher cleanup.
4. Require both endpoint and credential when declaring the three built-in
   device/location collectors configured.

No source credentials, known target coordinates or precision overrides are
introduced. The native discovery and bounded Claude fallback remain unchanged.

## Verification

Behavioral checks execute the actual client watcher with deferred requests to
exercise rapid first observations, canonical session reuse, persistence outage
visibility, recovery, existing-session preservation, aborts and late callbacks.
Collector checks cover missing endpoint, missing token and complete settings.
The established Spectra suite additionally checks provider normalization,
identity binding, uncertainty calibration, radio constraints, import formats,
motion behavior, hidden commands and database schema handling.

The production baseline browser result was cross-referenced with runtime logs:
`POST /api/spectra/acquire` returned HTTP 200 at 02:31:27 UTC after 10.581 seconds;
the geocoder recorded unresolved clues, and the browser reported no timestamped
coordinate evidence. HTTP success means discovery completed, not that precise
location was found.

## Primary-source research

- [ExifReader](https://github.com/mattiasw/ExifReader): original-file metadata
  extraction and documented mobile `accept="image/*"` GPS stripping.
- [Android Wi-Fi RTT](https://developer.android.com/develop/connectivity/wifi/wifi-rtt):
  measurements from three or more compatible access points can support typical
  1–2 meter positioning; requires capable hardware, permissions and reference
  positions.
- [CAMARA DeviceLocation](https://github.com/camaraproject/DeviceLocation/blob/main/code/API_definitions/location-retrieval.yaml):
  provider onboarding, access authorization, measurement freshness and region
  uncertainty; no guaranteed 7.62 meter result.
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect):
  identity claims and separately scoped access to other APIs. The documented
  sign-in identity claims do not supply current device coordinates.
- [W3C Geolocation](https://www.w3.org/TR/geolocation/): the hosting device's
  provider supplies observations; requesting high accuracy is not a guarantee.

Further source discovery can find additional evidence or a usable upstream
integration. It cannot substitute for absent current spatial observations.

## Production follow-up

PR #1271 deployed successfully to Bad-Blue production. The full production
build and Spectra suite passed; repository-wide type checking retained the
same 246 pre-existing diagnostics after worktree-path and union-order
normalization, with no added errors.

The live `Show me` launch at 03:30 UTC completed across nine source groups in
5.816 seconds. It still supplied no timestamped subject coordinate evidence.
The browser/log comparison exposed a separate false regional candidate:
the conversational word `me` was parsed as the state abbreviation `ME`,
producing `Show, ME` and an unrelated geocoder match. Follow-up repairs require
geographic context for ambiguous conversational/state words and reject
account containers such as `in my contacts` as physical locations. Regression
checks require identity-only launches to issue zero geocoder requests while
preserving actual city/state and street-address clues.
