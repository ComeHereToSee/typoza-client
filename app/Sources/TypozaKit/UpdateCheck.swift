import Foundation

/// 检查更新(对照表 A-04):更新源是一个 JSON 文件,地址写在 Info.plist 的 TypozaUpdateFeedURL。
/// 格式【假设:更新服务未定,先按最小字段定】:{"version": "1.2.0", "url": "https://…/Typoza.dmg", "notes": "更新说明"}。
public enum UpdateCheck {
    public struct Release: Equatable {
        public let version: String
        public let url: URL
        public let notes: String
    }

    /// 版本号逐段按数字比较(1.10.0 比 1.9.3 新);开头的 v 忽略,缺的段按 0。
    public static func isNewer(_ candidate: String, than current: String) -> Bool {
        let a = parts(candidate)
        let b = parts(current)
        for i in 0 ..< max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    static func parts(_ version: String) -> [Int] {
        let trimmed = version.trimmingCharacters(in: .whitespaces)
        let body = trimmed.hasPrefix("v") || trimmed.hasPrefix("V") ? String(trimmed.dropFirst()) : trimmed
        return body.split(separator: ".").map { part in Int(String(part.prefix(while: { $0.isASCII && $0.isNumber }))) ?? 0 }
    }

    public static func parse(_ data: Data) throws -> Release {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            throw BridgeError("更新信息不是有效的 JSON")
        }
        guard let version = obj["version"] as? String, !version.isEmpty else { throw BridgeError("更新信息缺少版本号") }
        guard let link = obj["url"] as? String, let url = URL(string: link), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            throw BridgeError("更新信息里的下载地址无效")
        }
        return Release(version: version, url: url, notes: obj["notes"] as? String ?? "")
    }
}
