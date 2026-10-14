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
}
