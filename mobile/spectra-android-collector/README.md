# SPECTRA Android enrolled-device collector

This library is a reference collector for an **already enrolled** Android
device. It does not contain a consent/authorization workflow.

The host application supplies:

- the Bad-Blue HTTPS base URL,
- the stable enrolled `deviceRef`, and
- the device reporter token issued for that existing enrollment.

The collector reports to:

`POST /api/geoconsole/telemetry/enrolled/:deviceRef/normalize/android-radio-collector`

## Measurements

When Android and the hardware expose them, the collector snapshots:

- Android GPS/GNSS location and raw `GnssMeasurementsEvent` fields,
- serving/neighbor cellular identities and signal measurements,
- Wi-Fi RTT/802.11mc responders,
- BLE scan RSSI/Tx-power observations,
- UWB measurements supplied by an already-established UWB peer session.

UWB cannot be invented without a peer/accessory ranging session. The host app
feeds those actual measurements to `recordUwbMeasurement`; SPECTRA resolves
known peer IDs through its configured anchor catalog.

Wi-Fi RTT and BLE observations without a known anchor remain radio/ranging
context rather than being turned into coordinates.

## Permissions

The manifest declares the relevant Android permissions. The embedding app is
responsible for requesting runtime permissions normally through Android. The
collector does not bypass denied permissions; unavailable measurements are
simply omitted.

Call `start()` after runtime permissions are granted, then invoke
`collectAndUpload` on the schedule appropriate for the enrolled device.
Call `stop()` when collection should stop.

The server accepts only the platform-appropriate normalizer, verifies the
per-device reporter credential, stores the canonical batch in the enrolled
device inbox, and later joins it to a lookup only after the phone number has
resolved to that same stable `deviceRef`.
