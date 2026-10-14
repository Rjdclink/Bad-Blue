# SPECTRA enrolled-device live acquisition contract — 2026-10-14

## Scope

SPECTRA assumes remote device lookups reaching this layer have already been
authorized and enrolled outside SPECTRA. SPECTRA does not request, store or
verify consent forms, authorization forms, approval callbacks or tokens from a
separate authorization application.

Its operational requirement is narrower: a phone number used for active
acquisition must already map to one tenant-scoped enrolled device record. That
record supplies the stable `deviceRef`, platform and optional upstream tracker
identifiers.

## Enrollment record

The canonical server-side mapping is `public.spectra_enrolled_devices`:

- `user_id`: tenant/platform user that owns the SPECTRA investigation.
- `phone_e164`: canonical phone number.
- `device_ref`: stable identifier used by configured collectors.
- `platform`: `android`, `ios` or `other`.
- optional `subject_label`: prevents an enrollment for one named subject from
  being attached to a different named subject.
- optional `owntracks_user` + `owntracks_device`.
- optional `traccar_device_id`.

`SPECTRA_ENROLLED_DEVICES_JSON` is a server-side bootstrap/fallback for
deployments that have not populated the table yet. It is not a browser input.

When both a phone and device reference are supplied, they must resolve to the
same enrollment. Ambiguous phone mappings, a conflicting device reference, or
a conflicting subject label are rejected before any live provider request.

## Native enrolled-device reporting

An enrolled native device can report telemetry directly to Bad-Blue without a
separate collector service:

`POST /api/geoconsole/telemetry/enrolled/:deviceRef/normalize/:kind`

The device uses its operational enrollment bearer token. An authenticated
Bad-Blue user who already owns that enrolled-device record can rotate/issue the
reporter credential at:

`POST /api/geoconsole/enrolled-device/:deviceRef/ingest-token`

The plaintext credential is returned once to configure the native reporter.
SPECTRA stores only its SHA-256 hash in
`spectra_enrolled_devices.ingest_token_hash`; subsequent device reports use
that bearer token. This is a technical device credential, not a consent form,
authorization form, or integration with a separate authorization application.

The endpoint verifies the token against the durable enrolled-device registry,
checks that the requested normalizer is valid for the enrolled platform,
rejects a conflicting `deviceRef`, normalizes the measurements, and writes the
canonical batch to `spectra_enrolled_device_telemetry`. A later lookup of the
phone resolves the same stable `deviceRef` and reads only fresh device-reported
telemetry (five minutes by default, configurable with
`SPECTRA_ENROLLED_TELEMETRY_MAX_AGE_MS`). The inbox retains at most the latest
256 payloads per device.

## Android

The dedicated Android collector uses
`SPECTRA_ANDROID_RADIO_COLLECTOR_URL_TEMPLATE` with `{{deviceRef}}` and
`SPECTRA_ANDROID_RADIO_COLLECTOR_TOKEN`.

SPECTRA POSTs:

```json
{
  "deviceRef": "stable-enrolled-device-ref",
  "sessionId": "spectra-session-id",
  "subjectLabel": "investigation subject",
  "platform": "android",
  "requestedAt": "ISO-8601"
}
```

The collector response is routed through the existing
`android-radio-collector` normalizer. It may contain the measurements that the
enrolled Android application actually supplies, including Android location,
raw GNSS context, cellular observations, Wi-Fi RTT/ranging, UWB and supported
Bluetooth ranging/scanning data.

A collector that returns a different `deviceRef`, session or subject is
rejected.

The existing Android managed-device location adapter remains an independent
parallel source. It is not replaced by the radio collector.

## Apple

Apple has two independent paths.

The existing Apple supervised-device adapter consumes Managed Lost Mode
DeviceLocation results when an organization has that source available.

The new `SPECTRA_APPLE_DEVICE_COLLECTOR_URL_TEMPLATE` path accepts canonical
telemetry from an enrolled Apple application. A typical source is Core Location
for geographic position. Supported Nearby Interaction / accessory ranging data
may be supplied as UWB or Bluetooth Channel Sounding measurements when the
upstream Apple application actually has such a session.

SPECTRA does not pretend iOS exposes Android-style raw cellular scans or
Android Wi-Fi RTT APIs. Apple observations are accepted according to the
capabilities the enrolled Apple application or managed-device provider really
returns.

The Apple collector request has the same envelope as Android with
`"platform": "ios"`. Canonical measurement objects should include the stable
`deviceRef` in measurement metadata when available so SPECTRA can reject a
mismatched device assertion.

## OwnTracks and Traccar

These are additional location sources, not replacements for the platform
collectors.

OwnTracks Recorder is queried for the exact enrolled
`owntracks_user`/`owntracks_device` mapping. Returned location rows become
canonical `device_gps` measurements.

Traccar is queried for the exact enrolled numeric device ID. SPECTRA first
verifies the returned device ID, then obtains that device's reported
`positionId`, and finally accepts only a position whose `deviceId` still
matches.

## Carrier location

CAMARA and Vonage Device Location Retrieval are dedicated carrier lanes. They
are deliberately outside `SPECTRA_ACTIVE_PROVIDER_ADAPTERS` so generic JSON
configuration cannot silently turn a carrier operation into an arbitrary
target. When configured, both carrier lanes run independently in parallel with
device and tracker acquisition.

The direct CAMARA active lane is intentionally phone-bound. SPECTRA sends the
enrolled E.164 number in the request with a provider token suitable for a
two-legged integration. A three-legged token identifies one device and therefore
must not be stored once and reused across unrelated enrolled phones; those
token-bound/provider-managed responses can continue to enter through SPECTRA's
existing signed CAMARA ingest/gateway. The enrolled phone mapping gates either
path before the measurement is associated with a SPECTRA subject.

One carrier failure does not cancel the other carrier, Android/Apple,
OwnTracks, Traccar or other active sources.

For Vonage, SPECTRA accepts either a current bearer/access token or server-side
application credentials. Application-credential mode requires
`SPECTRA_VONAGE_APPLICATION_ID`, `SPECTRA_VONAGE_PRIVATE_KEY` and
`SPECTRA_VONAGE_OAUTH_SCOPE`: SPECTRA mints a short-lived RS256 application
JWT, performs Vonage's documented CIBA authorization-id/access-token exchange
for the enrolled phone, and then calls Device Location Retrieval with that
access token. Provider authentication remains an external provider requirement;
it is not a SPECTRA consent-form workflow.

## Failure behavior

A provider that is missing, unconfigured, unavailable, rate-limited or
otherwise fails is represented as a skipped/failed attempt. Independent sources
continue.

Likewise, total public-web-search failure does not cancel active telemetry,
direct evidence or saved observations.

Search engines and paid providers retain bounded deadlines and cooldowns.
Providers without usable budget or authentication do not become prerequisites
for an acquisition.


## Reference native collectors

The repository now includes native reference collectors that speak the enrolled
device inbox protocol directly:

- `mobile/spectra-android-collector`: Android GNSS/raw GNSS, cellular,
  Wi-Fi RTT, BLE and host-supplied UWB session measurements.
- `mobile/spectra-apple-collector`: Apple Core Location, Core Bluetooth and
  host-supplied Nearby Interaction measurements.

The Apple collector deliberately does not claim Android-only raw cellular or
Wi-Fi RTT access. Both collectors omit measurements that the operating system
or hardware does not make available.
