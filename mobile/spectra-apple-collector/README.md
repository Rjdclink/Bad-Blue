# SPECTRA Apple enrolled-device collector

This Swift package is the Apple counterpart to the Android collector. It is
designed for an **already enrolled** iPhone/iPad and contains no SPECTRA
consent/authorization form.

The embedding app supplies the Bad-Blue HTTPS base URL, stable enrolled
`deviceRef`, and the device reporter token issued for that enrollment.

It reports canonical telemetry to:

`POST /api/geoconsole/telemetry/enrolled/:deviceRef/normalize/canonical-telemetry`

## Apple measurement model

Apple does not expose the same raw cellular and Wi-Fi RTT APIs available to an
Android collector. The package therefore uses the measurements Apple actually
makes available:

- Core Location for the device's geographic position,
- Core Bluetooth scan RSSI/Tx-power observations,
- Nearby Interaction output from an established UWB/accessory session.

Bluetooth observations become ranging evidence only when the embedding app
registers the corresponding anchor coordinates. Otherwise they remain radio
context. Nearby Interaction behaves the same way: the host app forwards the
real `NINearbyObject` from its established `NISession`; if a peer anchor is
known, SPECTRA receives UWB range evidence, otherwise it receives UWB context.

## System permissions

The embedding iOS app must include its normal location/Bluetooth usage
descriptions (for example `NSLocationWhenInUseUsageDescription`,
`NSLocationAlwaysAndWhenInUseUsageDescription` when background reporting is
needed, and `NSBluetoothAlwaysUsageDescription`) and request the applicable
iOS permissions normally.

The collector does not bypass denied/restricted system permission state.

## Flow

1. Start the collector after the app has the required OS permissions.
2. Optionally register known BLE/UWB anchors.
3. Forward actual Nearby Interaction objects from the app's NISession.
4. Call `collectAndUpload()` on the app's reporting schedule.
5. Bad-Blue authenticates the device reporter token and stores the canonical
   batch in the enrolled-device telemetry inbox.
6. A SPECTRA phone lookup resolves the same stable `deviceRef` and admits only
   fresh measurements from that enrolled device.
