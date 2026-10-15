import AppKit
import TypozaKit
import WebKit

/// 图片、媒体、剪贴板相关的桥接方法:拷贝带 RTF、复制为图片、网络图片拷贝与下载、用「预览」打开 PDF。
extension DocumentWindowController {
    /// 整体重写剪贴板:纯文本 + HTML,rtf 为 true 时由同一段 HTML 生成 RTF(网页自己写不了 public.rtf)。
    func writeClipboard(text: String, html: String?, rtf: Bool) throws {
        var rtfData: Data?
        if rtf, let html { rtfData = try RichText.rtf(fromHTML: html) }
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
        if let html { pb.setString(html, forType: .html) }
        if let rtfData { pb.setData(rtfData, forType: .rtf) }
    }

    /// 「复制为图片」:截取网页里的一块区域(CSS 像素,相对视口;WKWebView 坐标系左上为原点)放进剪贴板。
    func snapshotToClipboard(_ params: Params, reply: @escaping (Any?, String?) -> Void) {
        func number(_ key: String) -> CGFloat { CGFloat((params.raw[key] as? NSNumber)?.doubleValue ?? 0) }
        let rect = CGRect(x: number("x"), y: number("y"), width: number("width"), height: number("height"))
        guard rect.width >= 1, rect.height >= 1 else {
            reply(nil, "要复制的区域为空")
            return
        }
        let config = WKSnapshotConfiguration()
        config.rect = rect
        webView.takeSnapshot(with: config) { image, error in
            guard let image else {
                reply(nil, "截图失败:\(error?.localizedDescription ?? "未知错误")")
                return
            }
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.writeObjects([image])
            reply(nil, nil)
        }
    }

    /// 网络图片:下载后把图像数据与网址一起放进剪贴板。
    func copyRemoteImage(_ url: URL, reply: @escaping (Any?, String?) -> Void) {
        URLSession.shared.dataTask(with: url) { data, _, error in
            DispatchQueue.main.async {
                guard let data, let image = NSImage(data: data) else {
                    reply(nil, "无法下载图片:\(error?.localizedDescription ?? url.absoluteString)")
                    return
                }
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.writeObjects([image, url as NSURL])
                reply(nil, nil)
            }
        }.resume()
    }

    /// 下载网络文件到本机路径(「复制 / 移动所有图片到」时保存网络图片)。目标已存在时报错,不覆盖。
    func download(_ params: Params, reply: @escaping (Any?, String?) -> Void) {
        guard let url = URL(string: params.optionalString("url") ?? ""), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              let to = params.optionalString("to"), to.hasPrefix("/")
        else {
            reply(nil, "下载参数无效:需要 http(s) 网址与本机绝对路径")
            return
        }
        URLSession.shared.downloadTask(with: url) { tmp, response, error in
            let result = Result<Void, Error> {
                if let error { throw BridgeError("下载失败:\(error.localizedDescription)") }
                guard let tmp, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    throw BridgeError("下载失败:服务器返回 \((response as? HTTPURLResponse)?.statusCode ?? 0)")
                }
                if FileManager.default.fileExists(atPath: to) { throw BridgeError("目标位置已有同名文件:\(to)") }
                let target = URL(fileURLWithPath: to)
                try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                // 临时文件在回调返回后就被删除,必须在这里移走
                try FileManager.default.moveItem(at: tmp, to: target)
            }
            DispatchQueue.main.async {
                switch result {
                case .success: reply(nil, nil)
                case .failure(let error): reply(nil, error.localizedDescription)
                }
            }
        }.resume()
    }

    /// PDF 选中时 ⌘↩:用系统「预览」打开(PRD 3.5)。
    func openInPreview(_ params: Params, reply: @escaping (Any?, String?) -> Void) {
        let path = params.optionalString("path") ?? ""
        guard FileManager.default.fileExists(atPath: path) else {
            reply(nil, "文件不存在:\(path)")
            return
        }
        guard let preview = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Preview") else {
            reply(nil, "找不到系统「预览」应用")
            return
        }
        NSWorkspace.shared.open([URL(fileURLWithPath: path)], withApplicationAt: preview, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            DispatchQueue.main.async { reply(nil, error.map { "用「预览」打开失败:\($0.localizedDescription)" }) }
        }
    }
}
