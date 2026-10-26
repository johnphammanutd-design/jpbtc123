// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "KaireticCore", platforms: [.macOS(.v13), .iOS(.v17)], products: [.library(name: "KaireticCore", targets: ["KaireticCore"])], targets: [.target(name: "KaireticCore", path: "Core"), .testTarget(name: "KaireticCoreTests", dependencies: ["KaireticCore"], path: "Tests")])
