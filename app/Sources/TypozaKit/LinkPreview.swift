import Foundation

/// 书签卡片的网页信息:标题、描述、配图、图标(OpenGraph / Twitter Card / <title> / <link rel=icon>)。
public enum LinkPreview {
    public struct Info: Equatable {
        public var title: String
        public var description: String
        public var image: String?
        public var icon: String?
    }

    /// 从 HTML 文本解析(只看 <head> 附近,纯函数便于测试)。
    public static func parse(html: String, baseURL: URL) -> Info {
        let head = String(html.prefix(300_000))
        func meta(_ names: [String]) -> String? {
            for name in names {
                let patterns = [
                    "<meta[^>]+(?:property|name)=[\"']\(NSRegularExpression.escapedPattern(for: name))[\"'][^>]*content=[\"']([^\"']*)[\"']",
                    "<meta[^>]+content=[\"']([^\"']*)[\"'][^>]*(?:property|name)=[\"']\(NSRegularExpression.escapedPattern(for: name))[\"']",
                ]
                for p in patterns {
                    if let v = firstGroup(p, in: head), !v.isEmpty { return decodeEntities(v) }
                }
            }
            return nil
        }
        let title = meta(["og:title", "twitter:title"]) ?? firstGroup("<title[^>]*>([\\s\\S]*?)</title>", in: head).map { decodeEntities($0.trimmingCharacters(in: .whitespacesAndNewlines)) } ?? baseURL.absoluteString
        let description = meta(["og:description", "twitter:description", "description"]) ?? ""
        let image = meta(["og:image", "twitter:image", "og:image:url"]).flatMap { resolve($0, baseURL) }
        let iconHref = firstGroup("<link[^>]+rel=[\"'](?:shortcut )?icon[\"'][^>]*href=[\"']([^\"']+)[\"']", in: head)
            ?? firstGroup("<link[^>]+href=[\"']([^\"']+)[\"'][^>]*rel=[\"'](?:shortcut )?icon[\"']", in: head)
        let icon = iconHref.flatMap { resolve($0, baseURL) } ?? resolve("/favicon.ico", baseURL)
        return Info(title: title, description: description, image: image, icon: icon)
    }

    private static func firstGroup(_ pattern: String, in text: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: text)
        else { return nil }
        return String(text[r])
    }

    private static func resolve(_ href: String, _ base: URL) -> String? {
        URL(string: href, relativeTo: base)?.absoluteURL.absoluteString
    }

    static func decodeEntities(_ s: String) -> String {
        var out = s
        for (k, v) in ["&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&#x27;": "'", "&nbsp;": " "] {
            out = out.replacingOccurrences(of: k, with: v)
        }
        return out
    }

    /// 抓取网页(8 秒超时,最多读 1.5 MB)。
    public static func fetch(_ url: URL, completion: @escaping (Result<Info, Error>) -> Void) {
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Typoza", forHTTPHeaderField: "User-Agent")
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(BridgeError("获取网页信息失败:\(error.localizedDescription)")))
                return
            }
            guard let data, let http = response as? HTTPURLResponse, (200..<400).contains(http.statusCode) else {
                completion(.failure(BridgeError("获取网页信息失败:服务器返回 \((response as? HTTPURLResponse)?.statusCode ?? 0)")))
                return
            }
            let slice = data.prefix(1_500_000)
            let html = String(data: slice, encoding: .utf8) ?? String(data: slice, encoding: .isoLatin1) ?? ""
            completion(.success(parse(html: html, baseURL: http.url ?? url)))
        }.resume()
    }
}
