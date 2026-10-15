import Foundation
import UniformTypeIdentifiers

public enum MimeType {
    // 编辑器资源的关键类型写死:ES module 必须以 JavaScript MIME 返回,否则 WebKit 拒绝执行。
    private static let fixed: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "svg": "image/svg+xml",
        "wasm": "application/wasm",
        "woff2": "font/woff2",
        "woff": "font/woff",
        "ttf": "font/ttf",
        "md": "text/markdown; charset=utf-8",
    ]

    public static func forExtension(_ ext: String) -> String {
        let lower = ext.lowercased()
        if let m = fixed[lower] { return m }
        return UTType(filenameExtension: lower)?.preferredMIMEType ?? "application/octet-stream"
    }
}
