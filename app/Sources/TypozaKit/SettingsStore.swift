import Foundation

/// 偏好设置:一个 JSON 文件,所有窗口共享。键与默认值由网页侧定义,这里只负责读写合并。
public final class SettingsStore {
    private let url: URL
    private var cache: [String: Any]?
    private let lock = NSLock()

    public init(url: URL = AppPaths.settingsFile) {
        self.url = url
    }

    public func load() throws -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        if let cache { return cache }
        guard FileManager.default.fileExists(atPath: url.path) else {
            cache = [:]
            return [:]
        }
        let data = try Data(contentsOf: url)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BridgeError("偏好设置文件格式错误:\(url.path)")
        }
        cache = obj
        return obj
    }

    public func merge(_ patch: [String: Any]) throws {
        var current = try load()
        lock.lock()
        defer { lock.unlock() }
        for (k, v) in patch { current[k] = v }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: current, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
        cache = current
    }
}
