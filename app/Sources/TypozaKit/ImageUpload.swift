import Foundation

/// 图片上传命令(Typora「自定义命令」上传):命令接收图片路径参数,标准输出末尾几行是上传后的网址。
public enum ImageUpload {
    /// 取输出里最后 count 个 http(s) 网址(PicGo 等工具会先打印日志,网址在最后)。
    public static func parseURLs(_ output: String, count: Int) -> [String] {
        let urls = output
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasPrefix("http://") || $0.hasPrefix("https://") }
        return Array(urls.suffix(count))
    }

    /// shell 单引号转义,命令通过 zsh -lc 执行(用户的 PATH 才生效)。
    public static func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    public static func run(command: String, paths: [String]) throws -> [String] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", ([command] + paths.map(shellQuote)).joined(separator: " ")]
        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        try process.run()
        let outData = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let stdout = String(data: outData, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw BridgeError("上传命令失败(退出码 \(process.terminationStatus)):\(String(data: errData, encoding: .utf8) ?? "")")
        }
        let urls = parseURLs(stdout, count: paths.count)
        guard urls.count == paths.count else { throw BridgeError("上传命令没有输出 \(paths.count) 个网址:\n\(stdout)") }
        return urls
    }
}
