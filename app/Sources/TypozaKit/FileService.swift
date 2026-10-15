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
        // 原子保存要在同一文件夹里先写临时文件再替换,所以文件本身与所在文件夹都可写才算可写(PRD 3.1 只读文件)
        let writable = FileManager.default.isWritableFile(atPath: path) && FileManager.default.isWritableFile(atPath: url.deletingLastPathComponent().path)
        var out: [String: Any] = ["path": path, "name": url.lastPathComponent, "isDir": isDir.boolValue, "size": size, "mtime": mtime, "writable": writable]
        if let created = attrs[.creationDate] as? Date { out["ctime"] = Int64((created.timeIntervalSince1970 * 1000).rounded()) }
        return out
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

    /// 移到废纸篓(可恢复),不做永久删除。返回在废纸篓里的路径(撤销用),系统没给时为 nil。
    @discardableResult
    public static func trash(_ path: String) throws -> String? {
        var result: NSURL?
        try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: &result)
        return result?.path
    }

    /// 可在 Typoza 里打开的文本文件扩展名(对照表 F-04);与网页侧 core/filetypes.ts 的 TEXT_EXTENSIONS 同一份清单。
    public static let textExtensions: Set<String> = ["md", "markdown", "mmd", "mdown", "mkd", "mdwn", "mdtxt", "mdtext", "txt", "text", "rmd", "rmarkdown"]

    public static func isTextDocument(_ path: String) -> Bool {
        textExtensions.contains((path as NSString).pathExtension.lowercased())
    }

    public static func isTextBundle(_ path: String) -> Bool {
        (path as NSString).pathExtension.lowercased() == "textbundle"
    }

    /// TextBundle 包里的正文(text.md / text.markdown / text.txt,对照表 X-53)
    public static func textBundleText(_ bundle: String) -> String? {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: bundle)) ?? []
        guard let name = names.first(where: { ["text.md", "text.markdown", "text.txt"].contains($0.lowercased()) }) else { return nil }
        return (bundle as NSString).appendingPathComponent(name)
    }

    /// 递归列出可打开的文件(Markdown 与纯文本,TextBundle 包算一个);跳过隐藏目录、node_modules 等,最多 20000 个。
    public static func listMarkdown(_ root: String, limit: Int = 20000) -> [String] {
        var out: [String] = []
        let skip: Set<String> = ["node_modules", ".git", ".typoza", "Library"]
        guard let it = FileManager.default.enumerator(at: URL(fileURLWithPath: root), includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return out }
        for case let url as URL in it {
            if skip.contains(url.lastPathComponent) {
                it.skipDescendants()
                continue
            }
            if isTextBundle(url.path) {
                it.skipDescendants()
                out.append(url.path)
            } else if isTextDocument(url.path) {
                out.append(url.path)
            }
            if out.count >= limit { break }
        }
        return out.sorted()
    }

    /// 文档的第一个标题(快速打开按标题匹配);TextBundle 读包里的正文。读不到或没有标题返回 nil。
    public static func firstHeading(atPath path: String) -> String? {
        let file = isTextBundle(path) ? textBundleText(path) : path
        guard let file, let data = FileManager.default.contents(atPath: file), let text = try? TextEncoding.decode(data).text else { return nil }
        return firstHeading(in: text)
    }

    /// 第一个 ATX 标题(`# 标题`)或 Setext 标题的文字;跳过开头的 YAML front matter 与围栏代码块。
    public static func firstHeading(in text: String) -> String? {
        var lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        if let first = lines.first, first.hasPrefix("\u{FEFF}") { lines[0] = String(first.dropFirst()) }
        if lines.first == "---", let end = lines.dropFirst().firstIndex(where: { $0 == "---" || $0 == "..." }) {
            lines.removeSubrange(0 ... end)
        }
        var inFence = false
        for (i, raw) in lines.enumerated() {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") || line.hasPrefix("~~~") {
                inFence.toggle()
                continue
            }
            if inFence { continue }
            if line.hasPrefix("#") {
                let hashes = line.prefix(while: { $0 == "#" }).count
                let rest = line.dropFirst(hashes)
                guard hashes <= 6, let space = rest.first, space == " " || space == "\t" else { continue }
                var title = rest.trimmingCharacters(in: .whitespaces)
                // 结尾的 # 是可选的闭合符号
                while title.hasSuffix("#") { title.removeLast() }
                title = title.trimmingCharacters(in: .whitespaces)
                if !title.isEmpty { return title }
                continue
            }
            if !line.isEmpty, i + 1 < lines.count {
                let next = lines[i + 1].trimmingCharacters(in: .whitespaces)
                let underline = !next.isEmpty && (next.allSatisfy { $0 == "=" } || next.allSatisfy { $0 == "-" })
                let listOrQuote = line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") || line.hasPrefix(">")
                if underline && !listOrQuote { return line }
            }
        }
        return nil
    }
}
