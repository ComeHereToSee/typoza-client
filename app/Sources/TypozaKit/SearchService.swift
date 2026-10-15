import Foundation

/// 文件夹全文搜索(Typora ⇧⌘F):逐个 Markdown 文件按行匹配。纯文本或正则,可区分大小写、全词。
public enum SearchService {
    public struct Options {
        public var regex: Bool
        public var caseSensitive: Bool
        public var wholeWord: Bool
        public var limit: Int

        public init(regex: Bool, caseSensitive: Bool, wholeWord: Bool, limit: Int) {
            self.regex = regex
            self.caseSensitive = caseSensitive
            self.wholeWord = wholeWord
            self.limit = limit
        }
    }

    public static func makeRegex(_ query: String, _ o: Options) throws -> NSRegularExpression {
        var pattern = o.regex ? query : NSRegularExpression.escapedPattern(for: query)
        if o.wholeWord { pattern = "(?<![\\p{L}\\p{N}_])(?:\(pattern))(?![\\p{L}\\p{N}_])" }
        do {
            return try NSRegularExpression(pattern: pattern, options: o.caseSensitive ? [] : [.caseInsensitive])
        } catch {
            throw BridgeError("正则表达式有误:\(query)")
        }
    }

    public static func search(root: String, query: String, options: Options) throws -> [[String: Any]] {
        guard !query.isEmpty else { return [] }
        let re = try makeRegex(query, options)
        var hits: [[String: Any]] = []
        for path in FileService.listMarkdown(root) {
            guard let data = FileManager.default.contents(atPath: path),
                  let text = try? TextEncoding.decode(data).text
            else { continue }
            var matches: [[String: Any]] = []
            var lineNo = 0
            text.enumerateLines { line, stop in
                lineNo += 1
                let range = NSRange(line.startIndex..., in: line)
                if re.firstMatch(in: line, range: range) != nil {
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    matches.append(["line": lineNo, "text": String(trimmed.prefix(200))])
                    if matches.count >= 50 { stop = true }
                }
            }
            if !matches.isEmpty {
                hits.append(["path": path, "matches": matches])
                if hits.count >= options.limit { break }
            }
        }
        return hits
    }
}
