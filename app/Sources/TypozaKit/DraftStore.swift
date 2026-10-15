import Foundation

/// 未命名草稿(PRD 3.1、对照表 X-56):没保存过的新文档由网页停止输入 1 秒后交来备份,
/// 存在 Typoza 数据目录 drafts/<编号>.md;应用重启或网页进程崩溃后按编号恢复到原标签,首次保存或用户放弃后删除。
public final class DraftStore {
    public let directory: URL

    public init(directory: URL = AppPaths.support.appendingPathComponent("drafts", isDirectory: true)) {
        self.directory = directory
    }

    /// 编号由网页生成(时间戳 + 随机串),只允许字母、数字与连字符,防止拼出数据目录以外的路径。
    static func validate(_ id: String) throws {
        let ok = !id.isEmpty && id.count <= 64 && id.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "-") }
        guard ok else { throw BridgeError("草稿编号无效:\(id)") }
    }

    private func url(_ id: String) -> URL {
        directory.appendingPathComponent("\(id).md")
    }

    public func save(id: String, text: String) throws {
        try Self.validate(id)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        do {
            try Data(text.utf8).write(to: url(id), options: .atomic)
        } catch {
            throw BridgeError("草稿备份失败:\(error.localizedDescription)")
        }
    }

    public func read(id: String) throws -> String {
        try Self.validate(id)
        guard let data = FileManager.default.contents(atPath: url(id).path) else { throw BridgeError("找不到草稿:\(id)") }
        return String(decoding: data, as: UTF8.self)
    }

    public func remove(id: String) throws {
        try Self.validate(id)
        let path = url(id).path
        if FileManager.default.fileExists(atPath: path) { try FileManager.default.removeItem(atPath: path) }
    }

    /// 全部草稿编号,按创建先后(编号以时间戳开头)
    public func list() -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.filter { $0.hasSuffix(".md") }.map { String($0.dropLast(3)) }.filter { (try? Self.validate($0)) != nil }.sorted()
    }
}
