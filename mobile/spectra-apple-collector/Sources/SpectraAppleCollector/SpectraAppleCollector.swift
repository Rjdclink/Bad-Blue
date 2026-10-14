import Foundation
import Darwin
import CoreBluetooth
import CoreLocation
import NearbyInteraction

public final class SpectraAppleCollector: NSObject {
    public struct Anchor {
        public let id: String
        public let latitude: Double
        public let longitude: Double
        public let txPowerAtOneMeterDbm: Double?

        public init(
            id: String,
            latitude: Double,
            longitude: Double,
            txPowerAtOneMeterDbm: Double? = nil
        ) {
            self.id = id
            self.latitude = latitude
            self.longitude = longitude
            self.txPowerAtOneMeterDbm = txPowerAtOneMeterDbm
        }
    }

    public struct UploadResult {
        public let statusCode: Int
        public let accepted: Bool
        public let response: String
    }

    private let endpointBase: URL
    private let deviceRef: String
    private let ingestToken: String
    private let locationManager = CLLocationManager()
    private lazy var centralManager = CBCentralManager(delegate: self, queue: nil)

    private let lock = NSLock()
    private var active = false
    private var latestLocation: CLLocation?
    private var anchors: [String: Anchor] = [:]
    private var bleMeasurements: [[String: Any]] = []
    private var nearbyMeasurements: [[String: Any]] = []

    private static let iso8601 = ISO8601DateFormatter()

    public init(
        endpointBaseURL: URL,
        deviceRef: String,
        ingestToken: String
    ) {
        self.endpointBase = endpointBaseURL
        self.deviceRef = deviceRef
        self.ingestToken = ingestToken
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 1
    }

    /**
     Starts collection using permissions already granted by iOS.

     The embedding application owns the system permission request UI. This
     collector does not attempt to bypass denied/restricted permission state.
     */
    public func start() {
        lock.lock()
        active = true
        lock.unlock()

        switch locationManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            locationManager.startUpdatingLocation()
        default:
            break
        }

        if centralManager.state == .poweredOn {
            startBluetoothScan()
        }
    }

    public func stop() {
        lock.lock()
        active = false
        lock.unlock()
        locationManager.stopUpdatingLocation()
        centralManager.stopScan()
    }

    public func registerAnchor(_ anchor: Anchor, aliases: [String] = []) {
        lock.lock()
        anchors[anchor.id.lowercased()] = anchor
        for alias in aliases {
            anchors[alias.lowercased()] = anchor
        }
        lock.unlock()
    }

    /**
     The host app forwards real Nearby Interaction output from its established
     NISession. Nearby Interaction requires a peer/accessory discovery-token
     exchange; SPECTRA does not fabricate that pairing.
     */
    public func recordNearbyObject(
        _ object: NINearbyObject,
        peerRef: String,
        anchor: Anchor? = nil
    ) {
        let timestamp = Self.iso8601.string(from: Date())
        let distance = object.distance.map(Double.init)
        let direction = object.direction

        var metadata: [String: Any] = [
            "deviceRef": deviceRef,
            "platform": "ios",
            "providerKind": "apple-nearby-interaction",
            "peerRef": peerRef,
        ]
        if let direction {
            metadata["directionVector"] = [
                "x": Double(direction.x),
                "y": Double(direction.y),
                "z": Double(direction.z),
            ]
        }

        var measurement: [String: Any]
        if let anchor, let distance, distance >= 0 {
            measurement = [
                "kind": "ranging",
                "source": "uwb_range",
                "timestamp": timestamp,
                "provider": "apple-nearby-interaction",
                "correlationGroup": "apple-ni:\(deviceRef):\(peerRef)",
                "anchors": [[
                    "id": anchor.id,
                    "latitude": anchor.latitude,
                    "longitude": anchor.longitude,
                    "distanceMeters": distance,
                    "uncertaintyMeters": max(0.1, distance * 0.03),
                ]],
                "metadata": metadata,
            ]
        } else {
            var values: [String: Double] = [:]
            if let distance { values["distanceMeters"] = distance }
            if let direction {
                values["directionX"] = Double(direction.x)
                values["directionY"] = Double(direction.y)
                values["directionZ"] = Double(direction.z)
            }
            measurement = [
                "kind": "sensor",
                "source": "uwb_context",
                "timestamp": timestamp,
                "provider": "apple-nearby-interaction",
                "values": values,
                "metadata": metadata,
            ]
        }

        lock.lock()
        nearbyMeasurements.append(measurement)
        if nearbyMeasurements.count > 64 {
            nearbyMeasurements.removeFirst(nearbyMeasurements.count - 64)
        }
        lock.unlock()
    }

    /**
     Builds one canonical SPECTRA batch and posts it to Bad-Blue. Core Location
     is the Apple absolute-position source; BLE and Nearby Interaction remain
     ranging/context unless an anchor position is actually known.
     */
    public func collectAndUpload() async throws -> UploadResult {
        guard endpointBase.scheme?.lowercased() == "https" else {
            throw CollectorError.invalidEndpoint
        }
        guard !deviceRef.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              ingestToken.count >= 16 else {
            throw CollectorError.invalidEnrollment
        }

        lock.lock()
        let location = latestLocation
        let bluetooth = bleMeasurements
        let nearby = nearbyMeasurements
        lock.unlock()

        var measurements: [[String: Any]] = []
        if let location {
            measurements.append(positionMeasurement(location))
        }
        measurements.append(contentsOf: bluetooth)
        measurements.append(contentsOf: nearby)

        guard !measurements.isEmpty else {
            throw CollectorError.noMeasurements
        }

        let payload: [String: Any] = [
            "deviceRef": deviceRef,
            "sourceId": "enrolled-ios-device",
            "measurements": measurements,
            "metadata": [
                "deviceRef": deviceRef,
                "platform": "ios",
                "reportedAt": Self.iso8601.string(from: Date()),
            ],
        ]

        let devicePathCharacters = CharacterSet.alphanumerics
            .union(CharacterSet(charactersIn: "-._~"))
        guard let encodedRef = deviceRef.addingPercentEncoding(
            withAllowedCharacters: devicePathCharacters
        ) else {
            throw CollectorError.invalidEnrollment
        }
        let base = endpointBase.absoluteString.trimmingCharacters(
            in: CharacterSet(charactersIn: "/")
        )
        guard let endpoint = URL(
            string: "\(base)/api/geoconsole/telemetry/enrolled/\(encodedRef)/normalize/canonical-telemetry"
        ) else {
            throw CollectorError.invalidEndpoint
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 7
        request.setValue("Bearer \(ingestToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CollectorError.invalidResponse
        }
        let responseText = String(data: data.prefix(16_384), encoding: .utf8) ?? ""
        return UploadResult(
            statusCode: http.statusCode,
            accepted: (200...299).contains(http.statusCode),
            response: responseText
        )
    }

    private func positionMeasurement(_ location: CLLocation) -> [String: Any] {
        var row: [String: Any] = [
            "kind": "position",
            "source": "device_gps",
            "timestamp": Self.iso8601.string(from: location.timestamp),
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "confidence": confidence(for: location.horizontalAccuracy),
            "provider": "apple-core-location",
            "correlationGroup": "apple-core-location:\(deviceRef)",
            "metadata": [
                "deviceRef": deviceRef,
                "platform": "ios",
                "providerKind": "apple-core-location",
            ],
        ]
        if location.horizontalAccuracy >= 0 {
            row["accuracy"] = location.horizontalAccuracy
        }
        if location.verticalAccuracy >= 0 {
            row["altitude"] = location.altitude
            row["verticalAccuracy"] = location.verticalAccuracy
        }
        if location.speed >= 0 {
            row["speed"] = location.speed
        }
        if location.course >= 0 {
            row["heading"] = location.course
        }
        return row
    }

    private func confidence(for accuracy: CLLocationAccuracy) -> Double {
        guard accuracy > 0 else { return 0.6 }
        return max(0.25, min(0.98, 1 - log10(max(1, accuracy)) / 6))
    }

    private func startBluetoothScan() {
        lock.lock()
        let shouldScan = active
        lock.unlock()
        guard shouldScan else { return }
        centralManager.scanForPeripherals(
            withServices: nil,
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
        )
    }

    private func bluetoothMeasurement(
        peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi: NSNumber
    ) -> [String: Any] {
        let peerRef = peripheral.identifier.uuidString
        let key = peerRef.lowercased()
        lock.lock()
        let anchor = anchors[key]
        lock.unlock()

        let txPower = (advertisementData[CBAdvertisementDataTxPowerLevelKey] as? NSNumber)?
            .doubleValue
        let metadata: [String: Any] = [
            "deviceRef": deviceRef,
            "platform": "ios",
            "providerKind": "apple-core-bluetooth",
            "peerRef": peerRef,
            "localName": advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? "",
        ]

        if let anchor, let txPower {
            return [
                "kind": "ranging",
                "source": "ble_rssi",
                "timestamp": Self.iso8601.string(from: Date()),
                "provider": "apple-core-bluetooth",
                "correlationGroup": "apple-ble:\(deviceRef):\(peerRef)",
                "anchors": [[
                    "id": anchor.id,
                    "latitude": anchor.latitude,
                    "longitude": anchor.longitude,
                    "rssiDbm": rssi.doubleValue,
                    "txPowerAtOneMeterDbm": anchor.txPowerAtOneMeterDbm ?? txPower,
                ]],
                "metadata": metadata,
            ]
        }

        var values = ["rssiDbm": rssi.doubleValue]
        if let txPower { values["txPowerAtOneMeterDbm"] = txPower }
        return [
            "kind": "sensor",
            "source": "ble_gateway",
            "timestamp": Self.iso8601.string(from: Date()),
            "provider": "apple-core-bluetooth",
            "values": values,
            "metadata": metadata,
        ]
    }

    public enum CollectorError: Error {
        case invalidEndpoint
        case invalidEnrollment
        case noMeasurements
        case invalidResponse
    }
}

extension SpectraAppleCollector: CLLocationManagerDelegate {
    public func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard let newest = locations.max(by: { $0.timestamp < $1.timestamp }) else { return }
        lock.lock()
        latestLocation = newest
        lock.unlock()
    }

    public func locationManager(
        _ manager: CLLocationManager,
        didChangeAuthorization status: CLAuthorizationStatus
    ) {
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return }
        lock.lock()
        let shouldStart = active
        lock.unlock()
        if shouldStart {
            manager.startUpdatingLocation()
        }
    }
}

extension SpectraAppleCollector: CBCentralManagerDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else { return }
        startBluetoothScan()
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        let measurement = bluetoothMeasurement(
            peripheral: peripheral,
            advertisementData: advertisementData,
            rssi: RSSI
        )
        lock.lock()
        bleMeasurements.append(measurement)
        if bleMeasurements.count > 64 {
            bleMeasurements.removeFirst(bleMeasurements.count - 64)
        }
        lock.unlock()
    }
}
