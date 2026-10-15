import AppKit
import Foundation

/// 文件读写。所有路径都是绝对路径;写入原子化(先写临时文件再替换),避免断电或崩溃留下半个文件。
public enum FileService {
    public static func mtimeMillis(_ url: URL) throws -> Int64 {
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        let date = (attrs[.modificationDate] as? Date) ?? Date(timeIntervalSince1970: 0)
        return Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    public static func stat(_ path: String) -> [String: Any]? {
        let url = URL(fileURLWithPath: path)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir),
              let attrs = try? FileManager.default.attributesOfItem(atPath: path)
        else { return nil }
        let size = (attrs[.size] as? NSNumber)?.int64Value ?? 0
        let mtime = (try? mtimeMillis(url)) ?? 0
        return ["path": path, "name": url.lastPathComponent, "isDir": isDir.boolValue, "size": size, "mtime": mtime]
    }

    public static func readText(_ path: String, encoding: String?) throws -> [String: Any] {
        let url = URL(fileURLWithPath: path)
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw BridgeError("读取失败:\(path)(\(error.localizedDescription))")
        }
        let decoded = try TextEncoding.decode(data, preferred: encoding)
        return ["text": decoded.text, "encoding": decoded.encoding, "mtime": try mtimeMillis(url)]
    }

    public static func writeText(_ path: String, text: String, encoding: String?) throws -> [String: Any] {
        let url = URL(fileURLWithPath: path)
        let data = try TextEncoding.encode(text, as: encoding ?? "utf-8")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            throw BridgeError("保存失败:\(path)(\(error.localizedDescription))")
        }
        return ["mtime": try mtimeMillis(url)]
    }

    public static func writeBase64(_ path: String, base64: String) throws {
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            throw BridgeError("写入失败:内容不是合法的 base64")
        }
        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    public static func copy(from: String, to: String) throws {
        let dst = URL(fileURLWithPath: to)
        try FileManager.default.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: to) { throw BridgeError("目标已存在:\(to)") }
        try FileManager.default.copyItem(at: URL(fileURLWithPath: from), to: dst)
    }

    public static func listDir(_ path: String) throws -> [[String: Any]] {
        let names: [String]
        do {
            names = try FileManager.default.contentsOfDirectory(atPath: path)
        } catch {
            throw BridgeError("无法读取文件夹:\(path)(\(error.localizedDescription))")
        }
        let items = names.compactMap { stat((path as NSString).appendingPathComponent($0)) }
        // 文件夹在前,按名称自然排序(与 Finder 一致)
        return items.sorted { a, b in
            let ad = a["isDir"] as? Bool ?? false
            let bd = b["isDir"] as? Bool ?? false
            if ad != bd { return ad }
            return (a["name"] as? String ?? "").localizedStandardCompare(b["name"] as? String ?? "") == .orderedAscending
        }
    }

    public static func mkdir(_ path: String) throws {
        try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
    }

    public static func rename(from: String, to: String) throws {
        if FileManager.default.fileExists(atPath: to) { throw BridgeError("目标已存在:\(to)") }
        try FileManager.default.moveItem(atPath: from, toPath: to)
    }

    /// 移到废纸篓(可恢复),不做永久删除。
    public static func trash(_ path: String) throws {
        try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
    }

    static let markdownExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext"]

    /// 递归列出 Markdown 文件;跳过隐藏目录、node_modules 等,最多 20000 个。
    public static func listMarkdown(_ root: String, limit: Int = 20000) -> [String] {
        var out: [String] = []
        let skip: Set<String> = ["node_modules", ".git", ".typoza", "Library"]
        guard let it = FileManager.default.enumerator(at: URL(fileURLWithPath: root), includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return out }
        for case let url as URL in it {
            if skip.contains(url.lastPathComponent) {
                it.skipDescendants()
                continue
            }
            if markdownExtensions.contains(url.pathExtension.lowercased()) {
                out.append(url.path)
                if out.count >= limit { break }
            }
        }
        return out.sorted()
    }
}
