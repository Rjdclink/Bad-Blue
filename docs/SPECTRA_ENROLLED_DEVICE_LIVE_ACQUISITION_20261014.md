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

One carrier failure does not cancel the other carrier, Android/Apple,
OwnTracks, Traccar or other active sources.

## Failure behavior

A provider that is missing, unconfigured, unavailable, rate-limited or
otherwise fails is represented as a skipped/failed attempt. Independent sources
continue.

Likewise, total public-web-search failure does not cancel active telemetry,
direct evidence or saved observations.

Search engines and paid providers retain bounded deadlines and cooldowns.
Providers without usable budget or authentication do not become prerequisites
for an acquisition.
