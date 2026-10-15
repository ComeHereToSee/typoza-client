import AppKit

/// 拷贝时一并写入剪贴板的 RTF(对照表 E-02:拷贝同时写入 HTML、RTF、纯文本),粘进 Word、Pages、备忘录保留格式。
/// 网页只能写 HTML 与纯文本,RTF 由外壳从同一段 HTML 转出。
public enum RichText {
    /// HTML 片段 → RTF 数据。AppKit 的 HTML 导入依赖 WebKit,必须在主线程调用。
    public static func rtf(fromHTML html: String) throws -> Data {
        // 不声明编码时 AppKit 按 Latin-1 读,中文会乱码
        guard let data = ("<meta charset=\"utf-8\">" + html).data(using: .utf8) else {
            throw BridgeError("HTML 无法编码为 UTF-8")
        }
        let attributed: NSAttributedString
        do {
            attributed = try NSAttributedString(
                data: data,
                options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue],
                documentAttributes: nil
            )
        } catch {
            throw BridgeError("HTML 转 RTF 失败:\(error.localizedDescription)")
        }
        do {
            return try attributed.data(from: NSRange(location: 0, length: attributed.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])
        } catch {
            throw BridgeError("生成 RTF 失败:\(error.localizedDescription)")
        }
    }
}
