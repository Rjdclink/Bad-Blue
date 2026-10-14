import Foundation
import XCTest
@testable import SpectraAppleCollector

final class SpectraAppleCollectorTests: XCTestCase {
    func testCollectorCanBeConstructedForHttpsEndpoint() throws {
        let endpoint = try XCTUnwrap(URL(string: "https://example.test"))
        let collector = SpectraAppleCollector(
            endpointBaseURL: endpoint,
            deviceRef: "enrolled-ios-device",
            ingestToken: "fixture-device-token-long-enough"
        )
        XCTAssertNotNil(collector)
    }

    func testReportingEndpointEncodesDeviceRefAndKeepsCanonicalPath() throws {
        let endpoint = try SpectraAppleCollector.reportingEndpoint(
            baseURL: URL(string: "https://legalwhat.com/")!,
            deviceRef: "apple device/01"
        )
        XCTAssertEqual(
            endpoint.absoluteString,
            "https://legalwhat.com/api/geoconsole/telemetry/enrolled/apple%20device%2F01/normalize/canonical-telemetry"
        )
    }

    func testReportingEndpointRejectsNonHttps() {
        XCTAssertThrowsError(
            try SpectraAppleCollector.reportingEndpoint(
                baseURL: URL(string: "http://legalwhat.com")!,
                deviceRef: "apple-device-a"
            )
        )
    }

    func testAccuracyConfidenceRemainsBoundedAndMonotonic() {
        XCTAssertEqual(
            SpectraAppleCollector.confidence(forAccuracy: -1),
            0.6,
            accuracy: 0.0001
        )
        XCTAssertGreaterThan(
            SpectraAppleCollector.confidence(forAccuracy: 3),
            SpectraAppleCollector.confidence(forAccuracy: 300)
        )
        XCTAssertGreaterThanOrEqual(
            SpectraAppleCollector.confidence(forAccuracy: 10_000_000),
            0.25
        )
        XCTAssertLessThanOrEqual(
            SpectraAppleCollector.confidence(forAccuracy: 0.1),
            0.98
        )
    }
}
