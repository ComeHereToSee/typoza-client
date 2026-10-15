import Foundation

/// 在线嵌入能否显示:网页里的 iframe 拿不到对方是否拒绝被嵌入,由外壳请求一次看响应头。
/// 结果对应 PRD 3.5「离线或站点拒绝时显示『无法加载嵌入内容』」与 notion-input 三「该网站不允许嵌入」。
public enum EmbedPolicy {
    public enum Result: String {
        case ok
        /// 站点用 X-Frame-Options 或 CSP frame-ancestors 禁止被别的页面嵌入
        case refused
        /// 连不上(离线、超时)或服务器返回错误
        case unreachable
    }

    /// 按响应头判断能否被嵌入。Typoza 页面来源是 typoza://app,不可能出现在对方的来源白名单里,
    /// 所以 X-Frame-Options 只要有值(DENY / SAMEORIGIN / ALLOW-FROM)、frame-ancestors 只要不含 * 就算拒绝。
    public static func allowsFraming(headers: [String: String]) -> Bool {
        var lower: [String: String] = [:]
        for (key, value) in headers { lower[key.lowercased()] = value }
        if let xfo = lower["x-frame-options"]?.trimmingCharacters(in: .whitespaces), !xfo.isEmpty {
            return false
        }
        guard let csp = lower["content-security-policy"] else { return true }
        // 多条策略以逗号合并,任意一条限制了 frame-ancestors 都生效
        for policy in csp.split(separator: ",") {
            for directive in policy.split(separator: ";") {
                let parts = directive.split(whereSeparator: { $0 == " " || $0 == "\t" }).map { $0.lowercased() }
                guard parts.first == "frame-ancestors" else { continue }
                if !parts.dropFirst().contains("*") { return false }
            }
        }
        return true
    }

    /// 由 HTTP 状态码与响应头得出结果(纯函数,便于测试)。
    public static func evaluate(statusCode: Int, headers: [String: String]) -> Result {
        guard (200..<400).contains(statusCode) else { return .unreachable }
        return allowsFraming(headers: headers) ? .ok : .refused
    }

    /// 请求网址看响应头(8 秒超时)。完成回调在 URLSession 的后台队列。
    public static func check(_ url: URL, completion: @escaping (Result) -> Void) {
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Typoza", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: request) { _, response, error in
            guard error == nil, let http = response as? HTTPURLResponse else {
                completion(.unreachable)
                return
            }
            var headers: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                if let k = key as? String, let v = value as? String { headers[k] = v }
            }
            completion(evaluate(statusCode: http.statusCode, headers: headers))
        }.resume()
    }
}
