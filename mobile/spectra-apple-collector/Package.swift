// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SpectraAppleCollector",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "SpectraAppleCollector", targets: ["SpectraAppleCollector"]),
    ],
    targets: [
        .target(name: "SpectraAppleCollector"),
    ]
)
