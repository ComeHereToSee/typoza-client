import AppKit
import TypozaKit
import UniformTypeIdentifiers
import WebKit

/// WKScriptMessageHandler 会强引用处理器,中间放一个弱引用代理,避免窗口控制器与网页互相持有导致无法释放。
private final class WeakBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: DocumentWindowController?

    init(_ target: DocumentWindowController) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let target else {
            replyHandler(nil, "窗口已关闭")
            return
        }
        target.handle(message, reply: replyHandler)
    }
}

/// 一个窗口:一个 WKWebView 跑编辑器,经桥接调用原生能力。
final class DocumentWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private unowned let app: AppDelegate
    let webView: WKWebView
    private var openRequest: (String, Bool)?
    private let smokeOut: URL?
    private var ready = false
    private var queuedCommands: [String] = []
    private var allowClose = false
    private(set) var currentPath: String?
    private lazy var watcher = FileWatcher { [weak self] paths in
        self?.emit("fs.changed", ["paths": paths])
    }

    /// 空白新文档(没打开文件、没修改),可以直接拿来打开别的文件
    var isBlank: Bool { currentPath == nil && window?.isDocumentEdited != true }

    init(app: AppDelegate, open: (String, Bool)?, smokeOut: URL?) {
        self.app = app
        self.openRequest = open
        self.smokeOut = smokeOut
        guard let editorRoot = Bundle.main.resourceURL?.appendingPathComponent("editor", isDirectory: true) else {
            fatalError("应用包缺少 Resources/editor 目录")
        }
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(TypozaSchemeHandler(appRoot: editorRoot), forURLScheme: TypozaSchemeHandler.scheme)
        config.preferences.isElementFullscreenEnabled = true
        config.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: config)
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        webView.allowsMagnification = false
        webView.setValue(false, forKey: "drawsBackground")

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .visible
        window.tabbingMode = .automatic
        window.tabbingIdentifier = "TypozaDocument"
        window.minSize = NSSize(width: 520, height: 360)
        window.contentView = webView
        window.setFrameAutosaveName("TypozaDocumentWindow")
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        config.userContentController.addScriptMessageHandler(WeakBridge(self), contentWorld: .page, name: "typoza")
        if window.frameAutosaveName.isEmpty || !window.setFrameUsingName("TypozaDocumentWindow") { window.center() }
        if let open { window.title = (open.0 as NSString).lastPathComponent }
        webView.load(URLRequest(url: TypozaSchemeHandler.appURL("index.html")))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) 未实现")
    }

    // ---------- 与网页通信 ----------

    /// 向网页推事件(HostEvents)。
    func emit(_ event: String, _ payload: [String: Any]) {
        guard ready, let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        let name = (try? String(data: JSONSerialization.data(withJSONObject: [event]), encoding: .utf8)) ?? "[]"
        webView.evaluateJavaScript("window.__typozaEmit && window.__typozaEmit(\(name)[0], \(json))")
    }

    func sendCommand(_ id: String) {
        if ready { emit("menu.command", ["id": id]) } else { queuedCommands.append(id) }
    }

    func sendCommandWhenReady(_ id: String) {
        queuedCommands.append(id)
    }

    func load(path: String, isDir: Bool) {
        if ready {
            emit("app.open", ["path": path, "isDir": isDir])
        } else {
            openRequest = (path, isDir)
        }
    }

    /// 关窗口或退出前:让网页保存或询问。
    func prepareClose(_ completion: @escaping (Bool) -> Void) {
        guard ready else {
            completion(true)
            return
        }
        webView.callAsyncJavaScript("return await window.typoza.prepareClose()", arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): completion((value as? Bool) ?? true)
            case .failure: completion(true)
            }
        }
    }

    func handle(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
            reply(nil, "桥接消息格式错误:缺少 method")
            return
        }
        let params = Params((body["params"] as? [String: Any]) ?? [:])
        // 耗时操作放到后台线程,回复切回主线程
        func background(_ work: @escaping () throws -> Any?) {
            DispatchQueue.global(qos: .userInitiated).async {
                let result = Result { try work() }
                DispatchQueue.main.async {
                    switch result {
                    case .success(let value): reply(value, nil)
                    case .failure(let error): reply(nil, error.localizedDescription)
                    }
                }
            }
        }
        func sync(_ work: () throws -> Any?) {
            do { reply(try work(), nil) } catch { reply(nil, error.localizedDescription) }
        }

        switch method {
        case "app.info":
            let open = openRequest
            openRequest = nil
            sync { ["home": NSHomeDirectory(), "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev", "openPath": open?.0 as Any, "openIsDir": open?.1 ?? false, "dark": app.isDark] }
        case "app.ready":
            ready = true
            reply(nil, nil)
            for id in queuedCommands { emit("menu.command", ["id": id]) }
            queuedCommands.removeAll()
            if smokeOut != nil { runSmoke() }
        case "app.fatal":
            reply(nil, nil)
            let msg = params.optionalString("message") ?? "未知错误"
            NSLog("Typoza 网页启动失败:%@", msg)
            if let out = smokeOut { writeSmokeAndExit(["error": "网页启动失败:\(msg)"], to: out, code: 3) }
        case "app.openDocument":
            let path = params.optionalString("path") ?? ""
            sync {
                if path.isEmpty { app.newWindow(open: nil, asTabOf: params.bool("newWindow") ? nil : window) } else { app.open(path: path, isDir: false, newWindow: params.bool("newWindow")) }
                return nil
            }

        case "fs.readText":
            let encoding = params.optionalString("encoding")
            background { try FileService.readText(try params.string("path"), encoding: encoding) }
        case "fs.writeText":
            let history = app.history
            background {
                let path = try params.string("path")
                let text = try params.string("text")
                let isMarkdown = ["md", "markdown", "mdown", "mkd", "txt"].contains((path as NSString).pathExtension.lowercased())
                if isMarkdown { try? history.snapshotBeforeWrite(path: path) }
                let result = try FileService.writeText(path, text: text, encoding: params.optionalString("encoding"))
                if isMarkdown, let data = FileManager.default.contents(atPath: path) { try? history.snapshotAfterWrite(path: path, data: data) }
                return result
            }
        case "fs.writeBase64":
            background {
                try FileService.writeBase64(try params.string("path"), base64: try params.string("base64"))
                return nil
            }
        case "fs.copyFile":
            background {
                try FileService.copy(from: try params.string("from"), to: try params.string("to"))
                return nil
            }
        case "fs.stat":
            sync { FileService.stat(try params.string("path")) }
        case "fs.listDir":
            background { try FileService.listDir(try params.string("path")) }
        case "fs.mkdir":
            sync {
                try FileService.mkdir(try params.string("path"))
                return nil
            }
        case "fs.rename":
            sync {
                try FileService.rename(from: try params.string("from"), to: try params.string("to"))
                return nil
            }
        case "fs.trash":
            sync {
                try FileService.trash(try params.string("path"))
                return nil
            }
        case "fs.watch":
            watcher.watch(params.strings("paths"))
            reply(nil, nil)
        case "fs.search":
            background {
                let options = SearchService.Options(regex: params.bool("regex"), caseSensitive: params.bool("caseSensitive"), wholeWord: params.bool("wholeWord"), limit: params.int("limit", default: 200))
                return try SearchService.search(root: try params.string("root"), query: try params.string("query"), options: options)
            }
        case "fs.listMarkdown":
            background { FileService.listMarkdown(try params.string("root")) }

        case "window.setState":
            let path = params.optionalString("path")
            currentPath = path
            window?.title = params.optionalString("title") ?? "Typoza"
            window?.representedURL = path.map { URL(fileURLWithPath: $0) }
            window?.isDocumentEdited = params.bool("edited")
            reply(nil, nil)
        case "window.close":
            reply(nil, nil)
            allowClose = true
            window?.close()

        case "dialog.open":
            showOpenDialog(params, reply: reply)
        case "dialog.save":
            showSaveDialog(params, reply: reply)
        case "dialog.confirm":
            showConfirm(params, reply: reply)

        case "system.reveal":
            sync {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: try params.string("path"))])
                return nil
            }
        case "system.openURL":
            sync {
                guard let url = URL(string: try params.string("url")), ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else {
                    throw BridgeError("只能打开网页、邮件与电话链接")
                }
                NSWorkspace.shared.open(url)
                return nil
            }
        case "system.openWithDefaultApp":
            sync {
                let path = try params.string("path")
                guard FileManager.default.fileExists(atPath: path) else { throw BridgeError("文件不存在:\(path)") }
                NSWorkspace.shared.open(URL(fileURLWithPath: path))
                return nil
            }
        case "system.copyImage":
            sync {
                let path = try params.string("path")
                guard let image = NSImage(contentsOfFile: path) else { throw BridgeError("无法读取图片:\(path)") }
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.writeObjects([image, URL(fileURLWithPath: path) as NSURL])
                return nil
            }
        case "net.linkPreview":
            guard let url = URL(string: (try? params.string("url")) ?? ""), url.scheme?.hasPrefix("http") == true else {
                reply(nil, "网址无效")
                return
            }
            LinkPreview.fetch(url) { result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let info): reply(["url": url.absoluteString, "title": info.title, "description": info.description, "image": info.image as Any, "icon": info.icon as Any], nil)
                    case .failure(let error): reply(nil, error.localizedDescription)
                    }
                }
            }

        case "settings.get":
            sync { try app.settings.load() }
        case "settings.set":
            sync {
                try app.settings.merge(params.dictionary("patch"))
                return nil
            }

        case "history.list":
            sync { app.history.list(path: try params.string("path")) }
        case "history.read":
            sync { try app.history.read(path: try params.string("path"), id: try params.string("id")) }

        case "export.run":
            let pandocPath = (try? app.settings.load())?["pandocPath"] as? String
            ExportService.run(params: params, pandocPath: pandocPath) { error in
                reply(nil, error?.localizedDescription)
            }
        case "export.print":
            reply(nil, nil)
            printDocument()
        case "image.upload":
            background { try ImageUpload.run(command: try params.string("command"), paths: params.strings("paths")) }

        default:
            reply(nil, "未知桥接方法:\(method)")
        }
    }

    // ---------- 对话框 ----------

    private func contentTypes(_ exts: [String]) -> [UTType] {
        exts.compactMap { UTType(filenameExtension: $0) }
    }

    private func showOpenDialog(_ params: Params, reply: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        let directory = params.bool("directory")
        panel.canChooseDirectories = directory
        panel.canChooseFiles = !directory
        panel.allowsMultipleSelection = params.bool("multiple")
        let exts = params.strings("extensions")
        if !exts.isEmpty { panel.allowedContentTypes = contentTypes(exts) }
        guard let window else {
            reply(nil, "窗口不可用")
            return
        }
        panel.beginSheetModal(for: window) { response in
            reply(response == .OK ? panel.urls.map(\.path) : nil, nil)
        }
    }

    private func showSaveDialog(_ params: Params, reply: @escaping (Any?, String?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = params.optionalString("defaultName") ?? "未命名.md"
        let exts = params.strings("extensions")
        if !exts.isEmpty { panel.allowedContentTypes = contentTypes(exts) }
        panel.canCreateDirectories = true
        if let path = currentPath { panel.directoryURL = URL(fileURLWithPath: (path as NSString).deletingLastPathComponent) }
        guard let window else {
            reply(nil, "窗口不可用")
            return
        }
        panel.beginSheetModal(for: window) { response in
            reply(response == .OK ? panel.url?.path : nil, nil)
        }
    }

    private func showConfirm(_ params: Params, reply: @escaping (Any?, String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = params.optionalString("title") ?? ""
        alert.informativeText = params.optionalString("message") ?? ""
        switch params.optionalString("style") {
        case "warning": alert.alertStyle = .warning
        case "critical": alert.alertStyle = .critical
        default: alert.alertStyle = .informational
        }
        for title in params.strings("buttons") { alert.addButton(withTitle: title) }
        guard let window else {
            reply(alert.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue, nil)
            return
        }
        alert.beginSheetModal(for: window) { response in
            reply(response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue, nil)
        }
    }

    private func printDocument() {
        guard let window else { return }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.topMargin = 40
        info.bottomMargin = 40
        info.leftMargin = 40
        info.rightMargin = 40
        let op = webView.printOperation(with: info)
        op.view?.frame = webView.bounds
        op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    // ---------- 窗口 ----------

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if allowClose || !sender.isDocumentEdited { return true }
        prepareClose { [weak self] ok in
            guard ok, let self else { return }
            self.allowClose = true
            self.window?.close()
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        app.windowClosed(self)
    }

    // ---------- 导航与网页弹窗 ----------

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else {
            decisionHandler(.cancel)
            return
        }
        let isMainFrame = action.targetFrame?.isMainFrame ?? true
        if url.scheme == TypozaSchemeHandler.scheme || !isMainFrame || url.scheme == "about" || url.scheme == "blob" {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        // 主框架要跳到别处:本机 Markdown 在 Typoza 里打开,其它交给系统
        if url.isFileURL {
            if ["md", "markdown", "mdown", "mkd", "txt"].contains(url.pathExtension.lowercased()) {
                app.open(path: url.path, isDir: false, newWindow: true)
            } else {
                NSWorkspace.shared.open(url)
            }
        } else if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "好")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "好")
        alert.addButton(withTitle: "取消")
        alert.window.initialFirstResponder = field
        completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // 网页进程崩溃:重新载入(自动保存已落盘;未保存的新文档内容会丢失,记日志)
        NSLog("Typoza 网页进程意外退出,重新载入:%@", currentPath ?? "未命名")
        ready = false
        if let path = currentPath { openRequest = (path, false) }
        webView.load(URLRequest(url: TypozaSchemeHandler.appURL("index.html")))
    }

    // ---------- 冒烟自检(CI) ----------

    private func runSmoke() {
        guard let out = smokeOut else { return }
        let readySeconds = ProcessInfo.processInfo.systemUptime - app.launchUptime
        webView.callAsyncJavaScript("return await window.typoza.smoke()", arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            var report: [String: Any] = ["readySeconds": readySeconds]
            switch result {
            case .success(let value): report["result"] = value
            case .failure(let error): report["error"] = "页面自检失败:\(error)"
            }
            // 等灯箱动画结束再截图
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                self.webView.takeSnapshot(with: nil) { image, error in
                    do {
                        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
                        if let image {
                            try SmokeReport.writePNG(image, to: out.appendingPathComponent("smoke.png"))
                        } else {
                            report["snapshotError"] = "截图失败:\(String(describing: error))"
                        }
                    } catch {
                        report["snapshotError"] = "截图写入失败:\(error)"
                    }
                    self.writeSmokeAndExit(report, to: out, code: 0)
                }
            }
        }
    }

    private func writeSmokeAndExit(_ report: [String: Any], to out: URL, code: Int32) {
        do {
            try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
            try SmokeReport.writeJSON(report, to: out.appendingPathComponent("smoke.json"))
        } catch {
            FileHandle.standardError.write("写冒烟报告失败:\(error)\n".data(using: .utf8)!)
            exit(2)
        }
        exit(code)
    }
}
