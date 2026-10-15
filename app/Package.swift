// swift-tools-version:5.10
import PackageDescription

// 只在 GitHub Actions(macOS runner,完整 Xcode)上构建;本机不编译。
let package = Package(
    name: "Typoza",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "Typoza", targets: ["Typoza"]),
    ],
    targets: [
        .executableTarget(name: "Typoza", dependencies: ["TypozaKit"], path: "Sources/Typoza"),
        .target(name: "TypozaKit", path: "Sources/TypozaKit"),
        .testTarget(name: "TypozaKitTests", dependencies: ["TypozaKit"], path: "Tests/TypozaKitTests"),
    ]
)
