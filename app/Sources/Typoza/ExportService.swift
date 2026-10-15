import AppKit
import PDFKit
import TypozaKit
import WebKit

/// 导出:HTML 直接写文件;PDF 与图像用离屏 WKWebView 渲染导出 HTML;Word 等格式调用用户安装的 Pandoc。
enum ExportService {
    static let pandocFormats: [String: String] = [
        "docx": "docx", "odt": "odt", "rtf": "rtf", "epub": "epub", "latex": "latex",
        "mediawiki": "mediawiki", "rst": "rst", "textile": "textile", "opml": "opml",
    ]

    static func run(params: Params, pandocPath: String?, completion: @escaping (Error?) -> Void) {
        do {
            let format = try params.string("format")
            let target = URL(fileURLWithPath: try params.string("target"))
            let html = try params.string("html")
            switch format {
            case "html", "html-plain":
                try Data(html.utf8).write(to: target, options: .atomic)
                completion(nil)
            case "pdf", "image":
                OffscreenRenderer.render(html: html, nextTo: target) { renderer in
                    guard let renderer else {
                        completion(BridgeError("导出渲染失败"))
                        return
                    }
                    if format == "pdf" { renderer.exportPDF(to: target, completion: completion) } else { renderer.exportPNG(to: target, completion: completion) }
                }
            default:
                guard let to = pandocFormats[format] else { throw BridgeError("不支持的导出格式:\(format)") }
                let markdown = try params.string("markdown")
                let source = params.optionalString("sourcePath").map { URL(fileURLWithPath: $0).deletingLastPathComponent() }
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        let pandoc = try locatePandoc(configured: pandocPath)
                        var args = ["-f", "markdown+tex_math_dollars+pipe_tables+task_lists+strikeout+superscript+subscript+mark", "-t", to, "-o", target.path, "--standalone"]
                        if let source { args.append("--resource-path=\(source.path)") }
                        try runPandoc(pandoc, arguments: args, input: markdown, workingDirectory: source)
                        DispatchQueue.main.async { completion(nil) }
                    } catch {
                        DispatchQueue.main.async { completion(error) }
                    }
                }
            }
        } catch {
            completion(error)
        }
    }

    static func locatePandoc(configured: String?) throws -> String {
        let candidates = [configured, "/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc", "/usr/bin/pandoc"].compactMap { $0 }.filter { !$0.isEmpty }
        if let found = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) { return found }
        // 用户 shell 的 PATH 里找
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", "command -v pandoc"]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = Pipe()
        try p.run()
        p.waitUntilExit()
        let path = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard p.terminationStatus == 0, !path.isEmpty else {
            throw BridgeError("没有找到 Pandoc。导出 Word、EPUB、LaTeX 等格式需要先安装 Pandoc(brew install pandoc),或在偏好设置里填写路径。")
        }
        return path
    }

    static func runPandoc(_ pandoc: String, arguments: [String], input: String?, workingDirectory: URL?) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: pandoc)
        p.arguments = arguments
        if let workingDirectory { p.currentDirectoryURL = workingDirectory }
        let stdin = Pipe()
        let stderr = Pipe()
        p.standardInput = stdin
        p.standardError = stderr
        p.standardOutput = Pipe()
        try p.run()
        if let input { stdin.fileHandleForWriting.write(Data(input.utf8)) }
        try stdin.fileHandleForWriting.close()
        let errData = stderr.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else {
            throw BridgeError("Pandoc 转换失败:\(String(data: errData, encoding: .utf8) ?? "退出码 \(p.terminationStatus)")")
        }
    }
}

/// 离屏渲染导出 HTML。HTML 先写到目标旁的临时文件,用 file:// 加载,才能读到相对路径的图片。
final class OffscreenRenderer: NSObject, WKNavigationDelegate {
    private static var active: Set<OffscreenRenderer> = []
    private let window: NSWindow
    let webView: WKWebView
    private let tempFile: URL
    private var onLoad: ((OffscreenRenderer?) -> Void)?

    private init(tempFile: URL) {
        self.tempFile = tempFile
        let frame = NSRect(x: 0, y: 0, width: 900, height: 1200)
        webView = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
        window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
        window.contentView = webView
        super.init()
        webView.navigationDelegate = self
    }

    static func render(html: String, nextTo target: URL, completion: @escaping (OffscreenRenderer?) -> Void) {
        let temp = target.deletingLastPathComponent().appendingPathComponent(".typoza-export-\(UUID().uuidString).html")
        do {
            try Data(html.utf8).write(to: temp)
        } catch {
            completion(nil)
            return
        }
        let r = OffscreenRenderer(tempFile: temp)
        active.insert(r)
        r.onLoad = completion
        r.window.orderBack(nil)
        r.webView.loadFileURL(temp, allowingReadAccessTo: URL(fileURLWithPath: "/"))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // 等字体与图片就绪
        webView.callAsyncJavaScript(
            "await document.fonts.ready; await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r })));",
            arguments: [:], in: nil, in: .page
        ) { [weak self] _ in
            guard let self else { return }
            self.onLoad?(self)
            self.onLoad = nil
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        onLoad?(nil)
        onLoad = nil
        finish()
    }

    func exportPDF(to target: URL, completion: @escaping (Error?) -> Void) {
        let info = NSPrintInfo()
        info.paperSize = NSSize(width: 595, height: 842) // A4
        info.topMargin = 36
        info.bottomMargin = 36
        info.leftMargin = 36
        info.rightMargin = 36
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = target
        let op = webView.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        // WKWebView 的打印视图需要显式给尺寸,否则可能导出空白页
        op.view?.frame = webView.bounds
        op.runModal(for: window, delegate: self, didRun: #selector(printDone(_:success:contextInfo:)), contextInfo: Unmanaged.passRetained(CompletionBox(target: target, completion: completion)).toOpaque())
    }

    @objc private func printDone(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        guard let contextInfo else { return }
        let box = Unmanaged<CompletionBox>.fromOpaque(contextInfo).takeRetainedValue()
        let pages = PDFDocument(url: box.target)?.pageCount ?? 0
        box.completion(success && pages > 0 ? nil : BridgeError("PDF 导出失败"))
        finish()
    }

    func exportPNG(to target: URL, completion: @escaping (Error?) -> Void) {
        webView.evaluateJavaScript("Math.ceil(document.documentElement.scrollHeight)") { [weak self] value, _ in
            guard let self else { return }
            let height = min(CGFloat((value as? NSNumber)?.doubleValue ?? 1200), 30000)
            self.window.setContentSize(NSSize(width: 900, height: height))
            self.webView.frame = NSRect(x: 0, y: 0, width: 900, height: height)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                let config = WKSnapshotConfiguration()
                config.rect = NSRect(x: 0, y: 0, width: 900, height: height)
                self.webView.takeSnapshot(with: config) { image, error in
                    defer { self.finish() }
                    guard let image else {
                        completion(BridgeError("导出图像失败:\(error?.localizedDescription ?? "未知错误")"))
                        return
                    }
                    do {
                        try SmokeReport.writePNG(image, to: target)
                        completion(nil)
                    } catch {
                        completion(error)
                    }
                }
            }
        }
    }

    private func finish() {
        try? FileManager.default.removeItem(at: tempFile)
        window.orderOut(nil)
        Self.active.remove(self)
    }
}

private final class CompletionBox {
    let target: URL
    let completion: (Error?) -> Void

    init(target: URL, completion: @escaping (Error?) -> Void) {
        self.target = target
        self.completion = completion
    }
}
