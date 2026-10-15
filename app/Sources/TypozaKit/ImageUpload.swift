import Foundation

/// 图片上传(偏好「图像」页上传服务,对照表 PI-07):uPic、Picsee、PicGo-Core 走命令行;PicGo.app、PicList 走本机 HTTP 接口;
/// 也可以填自定义命令。命令接收图片路径参数,标准输出末尾几行是上传后的网址。iPic 不做(只有私有接口,同 M-29)。
public enum ImageUpload {
    public enum Service: String {
        case upic
        case picsee
        case picgoCore = "picgo-core"
        case picgoApp = "picgo-app"
        case piclist
        case custom
    }

    /// PicGo.app 与 PicList 的本机上传接口(两者默认同一端口,需在应用里开启 Server)
    public static let serverURL = URL(string: "http://127.0.0.1:36677/upload")!

    /// 命令行服务的命令(图片路径另加在后面);走 HTTP 接口的服务返回 nil
    public static func command(for service: Service, custom: String) throws -> String? {
        switch service {
        case .upic: return "/Applications/uPic.app/Contents/MacOS/uPic -o url -u"
        case .picsee: return "/Applications/Picsee.app/Contents/MacOS/Picsee -u"
        case .picgoCore: return "picgo upload"
        case .picgoApp, .piclist: return nil
        case .custom:
            let trimmed = custom.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw BridgeError("还没有设置上传命令:请在偏好设置「图像」页填写") }
            return trimmed
        }
    }

    /// 取输出里最后 count 个 http(s) 网址(PicGo 等工具会先打印日志,网址在最后)。
    public static func parseURLs(_ output: String, count: Int) -> [String] {
        let urls = output
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasPrefix("http://") || $0.hasPrefix("https://") }
        return Array(urls.suffix(count))
    }

    /// PicGo.app / PicList 的回应:{"success": true, "result": [网址…]};失败时带 message。
    public static func parseServerResponse(_ data: Data, count: Int) throws -> [String] {
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BridgeError("上传服务返回的不是 JSON:\(String(data: data, encoding: .utf8) ?? "")")
        }
        guard (obj["success"] as? Bool) == true, let urls = obj["result"] as? [String], urls.count == count else {
            throw BridgeError("上传失败:\((obj["message"] as? String) ?? String(data: data, encoding: .utf8) ?? "未知原因")")
        }
        return urls
    }

    /// shell 单引号转义,命令通过 zsh -lc 执行(用户的 PATH 才生效)。
    public static func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// 按服务上传;service 是偏好设置里存的名字(upic、picgo-app……)。
    public static func upload(service name: String, command custom: String, paths: [String]) throws -> [String] {
        guard let service = Service(rawValue: name) else { throw BridgeError("未知的上传服务:\(name)") }
        if let command = try command(for: service, custom: custom) {
            return try run(command: command, paths: paths)
        }
        return try uploadToServer(paths: paths, serviceName: service == .piclist ? "PicList" : "PicGo")
    }

    public static func run(command: String, paths: [String]) throws -> [String] {
        let result = try ShellCommand.run(([command] + paths.map(shellQuote)).joined(separator: " "), cwd: nil)
        guard result.status == 0 else {
            throw BridgeError("上传命令失败(退出码 \(result.status)):\(result.output)")
        }
        let urls = parseURLs(result.output, count: paths.count)
        guard urls.count == paths.count else { throw BridgeError("上传命令没有输出 \(paths.count) 个网址:\n\(result.output)") }
        return urls
    }

    static func uploadToServer(paths: [String], serviceName: String) throws -> [String] {
        var request = URLRequest(url: serverURL, timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["list": paths])
        let (data, _) = try HTTPRequest.send(request, failure: "无法连接 \(serviceName)(请确认 \(serviceName) 已打开并开启 Server)")
        return try parseServerResponse(data, count: paths.count)
    }
}

/// 在后台线程里同步等一个网络请求(桥接方法本来就在后台线程执行)。
public enum HTTPRequest {
    // 完成回调在 URLSession 的队列上执行,结果经这个盒子带回等待的线程(信号量保证先写后读)
    private final class ResultBox: @unchecked Sendable {
        var value: Result<(Data, URLResponse), Error>
        init(_ value: Result<(Data, URLResponse), Error>) { self.value = value }
    }

    public static func send(_ request: URLRequest, failure: String) throws -> (Data, URLResponse) {
        let done = DispatchSemaphore(value: 0)
        let box = ResultBox(.failure(BridgeError(failure)))
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let data, let response {
                box.value = .success((data, response))
            } else {
                box.value = .failure(BridgeError("\(failure):\(error?.localizedDescription ?? "没有响应")"))
            }
            done.signal()
        }.resume()
        done.wait()
        return try box.value.get()
    }
}

/// 下载网络文件到本机路径(插入网络图片时按规则落盘,对照表 PI-02)。
public enum FileDownload {
    public static func fetch(_ url: URL, to path: String) throws {
        let (data, response) = try HTTPRequest.send(URLRequest(url: url, timeoutInterval: 60), failure: "下载失败:\(url.absoluteString)")
        if let http = response as? HTTPURLResponse, !(200 ..< 300).contains(http.statusCode) {
            throw BridgeError("下载失败(HTTP \(http.statusCode)):\(url.absoluteString)")
        }
        let target = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: target, options: .atomic)
    }
}

/// 用 zsh -lc 执行一条命令(用户的 PATH 生效),合并标准输出与错误输出。
public enum ShellCommand {
    public static func run(_ command: String, cwd: String?) throws -> (status: Int32, output: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        if let cwd, !cwd.isEmpty { process.currentDirectoryURL = URL(fileURLWithPath: cwd) }
        let out = Pipe()
        process.standardOutput = out
        process.standardError = out
        process.standardInput = FileHandle.nullDevice
        try process.run()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }
}
