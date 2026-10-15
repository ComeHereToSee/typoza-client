import Foundation

/// 文件夹全文搜索(Typora ⇧⌘F,PRD 3.9):文件名与正文按行匹配。纯文本或正则,可区分大小写、全词。
/// 网页分批传入文件列表(paths)边搜边显示;命中行累计到 maxMatches 就停,网页据此提示「匹配结果过多」。
public enum SearchService {
    public struct Options {
        public var regex: Bool
        public var caseSensitive: Bool
        public var wholeWord: Bool
        /// 最多返回多少个文件
        public var limit: Int
        /// 只搜这些文件;nil 时搜 root 下全部可打开文件
        public var paths: [String]?
        /// 命中行累计上限
        public var maxMatches: Int

        public init(regex: Bool, caseSensitive: Bool, wholeWord: Bool, limit: Int, paths: [String]? = nil, maxMatches: Int = Int.max) {
            self.regex = regex
            self.caseSensitive = caseSensitive
            self.wholeWord = wholeWord
            self.limit = limit
            self.paths = paths
            self.maxMatches = maxMatches
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
        func matches(_ s: String) -> Bool {
            re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
        }
        var hits: [[String: Any]] = []
        var total = 0
        for path in options.paths ?? FileService.listMarkdown(root) {
            if total >= options.maxMatches { break }
            // TextBundle 搜包里的正文,结果仍报包的路径
            let file = FileService.isTextBundle(path) ? FileService.textBundleText(path) : path
            let nameMatch = matches((path as NSString).lastPathComponent)
            var lines: [[String: Any]] = []
            if let file, let data = FileManager.default.contents(atPath: file), let text = try? TextEncoding.decode(data).text {
                var lineNo = 0
                text.enumerateLines { line, stop in
                    lineNo += 1
                    if matches(line) {
                        let trimmed = line.trimmingCharacters(in: .whitespaces)
                        lines.append(["line": lineNo, "text": String(trimmed.prefix(200))])
                        if total + lines.count >= options.maxMatches { stop = true }
                    }
                }
            }
            total += lines.count
            if !lines.isEmpty || nameMatch {
                hits.append(["path": path, "nameMatch": nameMatch, "matches": lines])
                if hits.count >= options.limit { break }
            }
        }
        return hits
    }
}
