import Foundation

/// 桥接调用的来源校验。WKWebView 的 messageHandlers 对页面里所有框架都可见,
/// 文档中嵌入的第三方网页(视频、在线文档等 iframe)也能调用;只有编辑器自身(主框架、typoza://app)才可信。
public enum BridgeOrigin {
    public static func isTrusted(isMainFrame: Bool, scheme: String, host: String) -> Bool {
        isMainFrame && scheme == TypozaSchemeHandler.scheme && host == "app"
    }
}
