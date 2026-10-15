import CryptoKit
import Foundation

/// 本地历史版本(Typora「浏览所有版本」):每次保存留快照,同一文件 5 分钟内的保存合并成一个版本;
/// 每个文件最多 50 个、最长 90 天(与云端历史口径一致)。覆盖写之前若磁盘内容还没有快照,先给它留一份。
public final class HistoryStore {
    public static let coalesceSeconds: TimeInterval = 5 * 60
    public static let maxEntries = 50
    public static let maxAge: TimeInterval = 90 * 24 * 3600

    private let root: URL
    private let now: () -> Date

    public init(root: URL = AppPaths.historyDir, now: @escaping () -> Date = Date.init) {
        self.root = root
        self.now = now
    }

    private func folder(for path: String) -> URL {
        let digest = SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(String(digest.prefix(32)), isDirectory: true)
    }

    private func entries(in dir: URL) -> [URL] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        // 文件名是毫秒时间戳,按数字排序即时间顺序
        return names.filter { $0.hasSuffix(".md") }.sorted { (Int64($0.dropLast(3)) ?? 0) < (Int64($1.dropLast(3)) ?? 0) }.map { dir.appendingPathComponent($0) }
    }

    /// 保存前调用:磁盘上的旧内容若与最新快照不同,先存一份(防止「打开 → 改坏 → 自动保存」后找不回原文)。
    public func snapshotBeforeWrite(path: String) throws {
        guard let old = FileManager.default.contents(atPath: path) else { return }
        let dir = folder(for: path)
        if let last = entries(in: dir).last, FileManager.default.contents(atPath: last.path) == old { return }
        try write(old, dir: dir, path: path, coalesce: false)
    }

    /// 保存后调用:记录新内容。
    public func snapshotAfterWrite(path: String, data: Data) throws {
        try write(data, dir: folder(for: path), path: path, coalesce: true)
    }

    private func write(_ data: Data, dir: URL, path: String, coalesce: Bool) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data(path.utf8).write(to: dir.appendingPathComponent("path.txt"), options: .atomic)
        let list = entries(in: dir)
        if let last = list.last, FileManager.default.contents(atPath: last.path) == data { return }
        let stamp = Int64(now().timeIntervalSince1970 * 1000)
        if coalesce, let last = list.last, let t = Int64(last.deletingPathExtension().lastPathComponent),
           now().timeIntervalSince1970 - Double(t) / 1000 < Self.coalesceSeconds, list.count > 1
        {
            try FileManager.default.removeItem(at: last)
        }
        // 同一毫秒内的两次快照(保存前留原文 + 保存后)不能同名覆盖
        var unique = stamp
        while FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(unique).md").path) { unique += 1 }
        try data.write(to: dir.appendingPathComponent("\(unique).md"), options: .atomic)
        prune(dir)
    }

    private func prune(_ dir: URL) {
        var list = entries(in: dir)
        let cutoff = now().timeIntervalSince1970 - Self.maxAge
        while list.count > 1, let first = list.first, let t = Int64(first.deletingPathExtension().lastPathComponent), Double(t) / 1000 < cutoff {
            try? FileManager.default.removeItem(at: first)
            list.removeFirst()
        }
        while list.count > Self.maxEntries {
            try? FileManager.default.removeItem(at: list.removeFirst())
        }
    }

    public func list(path: String) -> [[String: Any]] {
        entries(in: folder(for: path)).reversed().map { url in
            let id = url.deletingPathExtension().lastPathComponent
            let size = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value ?? 0
            return ["id": id, "time": Int64(id) ?? 0, "size": size, "source": "local"]
        }
    }

    public func read(path: String, id: String) throws -> String {
        guard id.allSatisfy(\.isNumber) else { throw BridgeError("版本号无效") }
        let url = folder(for: path).appendingPathComponent("\(id).md")
        guard let data = FileManager.default.contents(atPath: url.path) else { throw BridgeError("找不到这个版本") }
        return try TextEncoding.decode(data).text
    }
}
