package com.legalwhat.spectra.collector

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.pm.PackageManager
import android.location.GnssMeasurementsEvent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.net.wifi.rtt.RangingRequest
import android.net.wifi.rtt.RangingResult
import android.net.wifi.rtt.RangingResultCallback
import android.net.wifi.rtt.WifiRttManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.CellInfo
import android.telephony.CellInfoCdma
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Reference collector for an already-enrolled Android phone.
 *
 * The host app owns Android runtime permission prompts and the reporting
 * schedule. This class never attempts to infer or bypass permission state.
 * Measurements are sent only to the configured SPECTRA enrolled-device inbox.
 */
class SpectraAndroidCollector(
    private val context: Context,
    endpointBaseUrl: String,
    private val deviceRef: String,
    private val ingestToken: String,
    private val executor: ExecutorService = Executors.newSingleThreadExecutor(),
) {
    companion object {
        fun reportingEndpoint(endpointBaseUrl: String, deviceRef: String): URI {
            val base = endpointBaseUrl.trim().trimEnd('/')
            require(base.startsWith("https://")) {
                "SPECTRA enrolled-device reporting requires HTTPS."
            }
            require(deviceRef.isNotBlank()) { "Enrolled deviceRef is required." }
            val encodedRef = URLEncoder
                .encode(deviceRef.trim(), StandardCharsets.UTF_8.name())
                .replace("+", "%20")
            return URI.create(
                "$base/api/geoconsole/telemetry/enrolled/$encodedRef/normalize/android-radio-collector"
            )
        }
    }

    data class UploadResult(val statusCode: Int, val accepted: Boolean, val response: String)

    private val endpointBase = endpointBaseUrl.trimEnd('/')
    private val locationManager =
        context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val telephonyManager =
        context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    private val wifiManager =
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val wifiRttManager =
        context.applicationContext.getSystemService(Context.WIFI_RTT_RANGING_SERVICE) as? WifiRttManager
    private val bluetoothManager =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

    @Volatile private var latestLocation: Location? = null
    @Volatile private var latestGnssEpoch: JSONObject? = null
    private val uwbObservations = CopyOnWriteArrayList<JSONObject>()

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            latestLocation = Location(location)
        }
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
    }

    private val gnssCallback = object : GnssMeasurementsEvent.Callback() {
        override fun onGnssMeasurementsReceived(eventArgs: GnssMeasurementsEvent) {
            latestGnssEpoch = gnssEpoch(eventArgs)
        }
    }

    private fun granted(permission: String): Boolean =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    /**
     * Starts location/raw-GNSS observation. The host app must have already
     * requested the corresponding runtime permissions.
     */
    @SuppressLint("MissingPermission")
    fun start() {
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION) ||
            granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        ) {
            runCatching {
                locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                    ?.let { latestLocation = Location(it) }
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    5_000L,
                    1f,
                    locationListener,
                    Looper.getMainLooper(),
                )
            }
        }
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            runCatching { locationManager.registerGnssMeasurementsCallback(context.mainExecutor, gnssCallback) }
        }
    }

    fun stop() {
        runCatching { locationManager.removeUpdates(locationListener) }
        runCatching { locationManager.unregisterGnssMeasurementsCallback(gnssCallback) }
    }

    /**
     * UWB sessions require an already-established peer/accessory configuration.
     * The host app can pass each measurement here; SPECTRA resolves a configured
     * anchor by peer id when latitude/longitude are not supplied.
     */
    fun recordUwbMeasurement(
        peerId: String,
        distanceMeters: Double,
        uncertaintyMeters: Double? = null,
        bearingDegrees: Double? = null,
        anchorLatitude: Double? = null,
        anchorLongitude: Double? = null,
    ) {
        if (!distanceMeters.isFinite() || distanceMeters < 0) return
        val row = JSONObject()
            .put("technology", "uwb")
            .put("peerId", peerId.take(200))
            .put("timestamp", Instant.now().toString())
            .put("distanceMeters", distanceMeters)
        uncertaintyMeters?.takeIf { it.isFinite() && it > 0 }
            ?.let { row.put("distanceUncertaintyMeters", it) }
        bearingDegrees?.takeIf { it.isFinite() }
            ?.let { row.put("bearingDegrees", ((it % 360) + 360) % 360) }
        if (
            anchorLatitude != null && anchorLongitude != null &&
            anchorLatitude in -90.0..90.0 && anchorLongitude in -180.0..180.0
        ) {
            row.put("anchor", JSONObject()
                .put("id", peerId.take(200))
                .put("latitude", anchorLatitude)
                .put("longitude", anchorLongitude))
        }
        uwbObservations += row
        while (uwbObservations.size > 64) uwbObservations.removeAt(0)
    }

    /** Runs one bounded collection pass and uploads it asynchronously. */
    fun collectAndUpload(callback: (Result<UploadResult>) -> Unit) {
        executor.execute {
            callback(runCatching {
                val wifiRows = CopyOnWriteArrayList<JSONObject>()
                val bleRows = CopyOnWriteArrayList<JSONObject>()
                val wifiDone = CountDownLatch(1)
                val bleDone = CountDownLatch(1)

                collectWifiRtt(wifiRows, wifiDone)
                collectBle(bleRows, bleDone)
                wifiDone.await(3, TimeUnit.SECONDS)
                bleDone.await(3, TimeUnit.SECONDS)

                val payload = JSONObject()
                    .put("deviceRef", deviceRef)
                    .put("timestamp", Instant.now().toString())
                    .put("cells", collectCells())
                    .put("gnss", JSONArray().put(latestGnssEpoch ?: fallbackGnssEpoch()))
                    .put("wifiRtt", JSONArray(wifiRows))
                    .put("bleScans", JSONArray(bleRows))
                    .put("rangingManager", JSONArray(uwbObservations.toList()))

                upload(payload)
            })
        }
    }

    @SuppressLint("MissingPermission")
    private fun collectCells(): JSONArray {
        val output = JSONArray()
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) return output
        val cells = runCatching { telephonyManager.allCellInfo }.getOrNull() ?: return output
        for (cell in cells.take(32)) {
            cellJson(cell)?.let { output.put(it) }
        }
        return output
    }

    private fun cellJson(cell: CellInfo): JSONObject? {
        val row = JSONObject()
            .put("timestamp", Instant.now().toString())
            .put("registered", cell.isRegistered)

        when (cell) {
            is CellInfoLte -> {
                val id = cell.cellIdentity
                val signal = cell.cellSignalStrength
                row.put("type", "lte")
                    .put("mcc", id.mccString?.toIntOrNull())
                    .put("mnc", id.mncString?.toIntOrNull())
                    .put("tac", id.tac)
                    .put("ci", id.ci)
                    .put("pci", id.pci)
                    .put("arfcn", id.earfcn)
                    .put("signal", JSONObject()
                        .put("rsrp", signal.rsrp)
                        .put("rsrq", signal.rsrq)
                        .put("rssnr", signal.rssnr))
            }
            is CellInfoNr -> {
                val id = cell.cellIdentity as android.telephony.CellIdentityNr
                val signal = cell.cellSignalStrength as android.telephony.CellSignalStrengthNr
                row.put("type", "nr")
                    .put("mcc", id.mccString?.toIntOrNull())
                    .put("mnc", id.mncString?.toIntOrNull())
                    .put("tac", id.tac)
                    .put("nci", id.nci)
                    .put("pci", id.pci)
                    .put("arfcn", id.nrarfcn)
                    .put("signal", JSONObject()
                        .put("ssRsrp", signal.ssRsrp)
                        .put("ssRsrq", signal.ssRsrq)
                        .put("ssSinr", signal.ssSinr))
            }
            is CellInfoWcdma -> {
                val id = cell.cellIdentity
                row.put("type", "wcdma")
                    .put("mcc", id.mccString?.toIntOrNull())
                    .put("mnc", id.mncString?.toIntOrNull())
                    .put("tac", id.lac)
                    .put("ci", id.cid)
                    .put("pci", id.psc)
                    .put("arfcn", id.uarfcn)
                    .put("signal", JSONObject().put("rssi", cell.cellSignalStrength.dbm))
            }
            is CellInfoGsm -> {
                val id = cell.cellIdentity
                row.put("type", "gsm")
                    .put("mcc", id.mccString?.toIntOrNull())
                    .put("mnc", id.mncString?.toIntOrNull())
                    .put("tac", id.lac)
                    .put("ci", id.cid)
                    .put("arfcn", id.arfcn)
                    .put("signal", JSONObject().put("rssi", cell.cellSignalStrength.dbm))
            }
            is CellInfoCdma -> {
                val id = cell.cellIdentity
                row.put("type", "cdma")
                    .put("systemId", id.systemId)
                    .put("networkId", id.networkId)
                    .put("baseStationId", id.basestationId)
                    .put("signal", JSONObject().put("rssi", cell.cellSignalStrength.dbm))
            }
            else -> return null
        }
        return row
    }

    @SuppressLint("MissingPermission")
    private fun collectWifiRtt(
        output: CopyOnWriteArrayList<JSONObject>,
        done: CountDownLatch,
    ) {
        val manager = wifiRttManager
        if (
            manager == null || !manager.isAvailable ||
            !granted(Manifest.permission.ACCESS_FINE_LOCATION) ||
            (
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                !granted(Manifest.permission.NEARBY_WIFI_DEVICES)
            )
        ) {
            done.countDown()
            return
        }

        val responders = runCatching { wifiManager.scanResults }
            .getOrDefault(emptyList())
            .filter { it.is80211mcResponder }
            .take(10)
        if (responders.isEmpty()) {
            done.countDown()
            return
        }

        val request = RangingRequest.Builder().addAccessPoints(responders).build()
        runCatching {
            manager.startRanging(request, context.mainExecutor, object : RangingResultCallback() {
                override fun onRangingFailure(code: Int) {
                    done.countDown()
                }

                override fun onRangingResults(results: MutableList<RangingResult>) {
                    for (result in results.take(32)) {
                        if (result.status != RangingResult.STATUS_SUCCESS) continue
                        output += JSONObject()
                            .put("timestamp", Instant.now().toString())
                            .put("bssid", result.macAddress?.toString())
                            .put("distanceMm", result.distanceMm)
                            .put("distanceStdDevMm", result.distanceStdDevMm)
                            .put("rssi", result.rssi)
                    }
                    done.countDown()
                }
            })
        }.onFailure { done.countDown() }
    }

    @SuppressLint("MissingPermission")
    private fun collectBle(
        output: CopyOnWriteArrayList<JSONObject>,
        done: CountDownLatch,
    ) {
        if (
            !granted(Manifest.permission.BLUETOOTH_SCAN)
            || !granted(Manifest.permission.BLUETOOTH_CONNECT)
        ) {
            done.countDown()
            return
        }
        val scanner = bluetoothManager?.adapter?.bluetoothLeScanner
        if (scanner == null) {
            done.countDown()
            return
        }

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (output.size >= 64) return
                output += JSONObject()
                    .put("timestamp", Instant.now().toString())
                    .put("beaconId", result.device.address)
                    .put("macAddress", result.device.address)
                    .put("rssi", result.rssi)
                    .put("txPower", if (result.txPower == Int.MIN_VALUE) JSONObject.NULL else result.txPower)
            }

            override fun onScanFailed(errorCode: Int) {
                done.countDown()
            }
        }
        runCatching { scanner.startScan(callback) }
            .onFailure {
                done.countDown()
                return
            }

        Handler(Looper.getMainLooper()).postDelayed({
            runCatching { scanner.stopScan(callback) }
            done.countDown()
        }, 2_000L)
    }

    private fun fallbackGnssEpoch(): JSONObject {
        val epoch = JSONObject()
            .put("timestamp", Instant.now().toString())
            .put("deviceRef", deviceRef)
            .put("satellites", JSONArray())
        latestLocation?.let { epoch.put("solution", locationJson(it)) }
        return epoch
    }

    private fun gnssEpoch(event: GnssMeasurementsEvent): JSONObject {
        val clock = event.clock
        val clockJson = JSONObject()
            .put("timeNanos", clock.timeNanos)
            .put("hardwareClockDiscontinuityCount", clock.hardwareClockDiscontinuityCount)
        if (clock.hasFullBiasNanos()) clockJson.put("fullBiasNanos", clock.fullBiasNanos)
        if (clock.hasBiasNanos()) clockJson.put("biasNanos", clock.biasNanos)
        if (clock.hasBiasUncertaintyNanos()) {
            clockJson.put("biasUncertaintyNanos", clock.biasUncertaintyNanos)
        }
        if (clock.hasDriftNanosPerSecond()) {
            clockJson.put("driftNanosPerSecond", clock.driftNanosPerSecond)
        }
        if (clock.hasDriftUncertaintyNanosPerSecond()) {
            clockJson.put("driftUncertaintyNanosPerSecond", clock.driftUncertaintyNanosPerSecond)
        }
        if (clock.hasTimeUncertaintyNanos()) {
            clockJson.put("timeUncertaintyNanos", clock.timeUncertaintyNanos)
        }

        val satellites = JSONArray()
        for (measurement in event.measurements.take(64)) {
            val row = JSONObject()
                .put("svid", measurement.svid)
                .put("constellationType", measurement.constellationType)
                .put("receivedSvTimeNanos", measurement.receivedSvTimeNanos)
                .put("receivedSvTimeUncertaintyNanos", measurement.receivedSvTimeUncertaintyNanos)
                .put("pseudorangeRateMetersPerSecond", measurement.pseudorangeRateMetersPerSecond)
                .put(
                    "pseudorangeRateUncertaintyMetersPerSecond",
                    measurement.pseudorangeRateUncertaintyMetersPerSecond,
                )
                .put("cn0DbHz", measurement.cn0DbHz)
                .put("state", measurement.state)
                .put("accumulatedDeltaRangeState", measurement.accumulatedDeltaRangeState)
            row.put("accumulatedDeltaRangeMeters", measurement.accumulatedDeltaRangeMeters)
            row.put(
                "accumulatedDeltaRangeUncertaintyMeters",
                measurement.accumulatedDeltaRangeUncertaintyMeters,
            )
            if (measurement.hasCarrierFrequencyHz()) {
                row.put("carrierFrequencyHz", measurement.carrierFrequencyHz)
            }
            satellites.put(row)
        }

        return JSONObject()
            .put("timestamp", Instant.now().toString())
            .put("deviceRef", deviceRef)
            .put("clock", clockJson)
            .put("satellites", satellites)
            .also { epoch -> latestLocation?.let { epoch.put("solution", locationJson(it)) } }
    }

    private fun locationJson(location: Location): JSONObject =
        JSONObject()
            .put("latitude", location.latitude)
            .put("longitude", location.longitude)
            .put("altitudeMeters", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
            .put(
                "horizontalAccuracyMeters",
                if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL,
            )
            .put("speedMetersPerSecond", if (location.hasSpeed()) location.speed.toDouble() else JSONObject.NULL)
            .put("headingDegrees", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)

    private fun upload(payload: JSONObject): UploadResult {
        require(endpointBase.startsWith("https://")) {
            "SPECTRA enrolled-device reporting requires HTTPS."
        }
        require(deviceRef.isNotBlank() && ingestToken.length >= 16)

        val endpoint = reportingEndpoint(endpointBase, deviceRef).toURL()
        val connection = endpoint.openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 7_000
            connection.readTimeout = 7_000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $ingestToken")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.outputStream.use {
                it.write(payload.toString().toByteArray(StandardCharsets.UTF_8))
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText().take(16_384) }
                .orEmpty()
            UploadResult(code, code in 200..299, text)
        } finally {
            connection.disconnect()
        }
    }
}
