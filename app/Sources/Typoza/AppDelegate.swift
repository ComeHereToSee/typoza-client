import AppKit
import TypozaKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply {
    private let launchUptime: TimeInterval
    private let smokeOut: URL?
    private var window: NSWindow?
    private var webView: WKWebView?

    init(launchUptime: TimeInterval) {
        self.launchUptime = launchUptime
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--smoke-out"), i + 1 < args.count {
            smokeOut = URL(fileURLWithPath: args[i + 1], isDirectory: true)
        } else {
            smokeOut = nil
        }
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let editorRoot = Bundle.main.resourceURL?.appendingPathComponent("editor", isDirectory: true) else {
            fatalError("应用包缺少 Resources/editor 目录")
        }
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(TypozaSchemeHandler(appRoot: editorRoot), forURLScheme: TypozaSchemeHandler.scheme)
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "typoza")

        let webView = WKWebView(frame: .zero, configuration: config)
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        self.webView = webView

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Typoza"
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)

        webView.load(URLRequest(url: TypozaSchemeHandler.appURL("index.html")))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
            replyHandler(nil, "桥接消息格式错误:缺少 method")
            return
        }
        switch method {
        case "app.ready":
            replyHandler(nil, nil)
            if smokeOut != nil { runSmoke() }
        default:
            replyHandler(nil, "未知桥接方法:\(method)")
        }
    }

    // 冒烟模式:编辑器就绪后跑页面内自检,写出 smoke.json 与窗口截图后退出。供 CI 验证打包产物真的能跑。
    private func runSmoke() {
        guard let out = smokeOut, let webView else { return }
        let readySeconds = ProcessInfo.processInfo.systemUptime - launchUptime
        webView.callAsyncJavaScript("return await window.typoza.smoke()", arguments: [:], in: nil, in: .page) { result in
            var report: [String: Any] = ["readySeconds": readySeconds]
            switch result {
            case .success(let value): report["result"] = value
            case .failure(let error): report["error"] = "页面自检失败:\(error)"
            }
            webView.takeSnapshot(with: nil) { image, error in
                do {
                    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
                    if let image {
                        try SmokeReport.writePNG(image, to: out.appendingPathComponent("smoke.png"))
                    } else {
                        report["snapshotError"] = "截图失败:\(String(describing: error))"
                    }
                    try SmokeReport.writeJSON(report, to: out.appendingPathComponent("smoke.json"))
                } catch {
                    FileHandle.standardError.write("写冒烟报告失败:\(error)\n".data(using: .utf8)!)
                    exit(2)
                }
                NSApp.terminate(nil)
            }
        }
    }
}
