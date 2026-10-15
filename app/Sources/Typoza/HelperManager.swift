import AppKit
import SystemConfiguration
import TypozaKit

/// 管理同步辅助进程 typoza-helper:按需启动、意外退出后退避重启、退出应用时让它收尾。
/// 会话密钥只存在钥匙串:启动后从钥匙串取出经管道交给辅助进程,辅助进程推来新密钥时写回钥匙串。
final class HelperManager {
    /// 把辅助进程的 sync.* 通知推给所有窗口
    var broadcast: ((String, [String: Any]) -> Void)?

    private let keychain = KeychainItem(service: "app.typoza.mac.sync", account: "session")
    // 钥匙串读写走串行队列,保证「写入新令牌」与「退出时删除」按发生顺序执行
    private let keychainQueue = DispatchQueue(label: "app.typoza.keychain")
    private var process: Process?
    private var connection: HelperConnection?
    private var startedAt = Date()
    private var restartDelay: TimeInterval = 1
    private var stopping = false

    private var executable: URL { Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/typoza-helper") }

    /// 应用启动后调用:用过云同步(有同步配置)才在后台启动辅助进程,否则等用户打开云同步设置时再启动。
    func startIfConfigured() {
        let config = AppPaths.syncDir.appendingPathComponent("config.json").path
        DispatchQueue.global(qos: .utility).async {
            guard FileManager.default.fileExists(atPath: config) else { return }
            DispatchQueue.main.async { self.ensureStarted() }
        }
    }

    /// 启动辅助进程(已在运行则什么也不做)。
    func ensureStarted() {
        guard process == nil, !stopping else { return }
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            NSLog("Typoza:找不到同步辅助进程 %@", executable.path)
            return
        }
        let deviceName = (SCDynamicStoreCopyComputerName(nil, nil) as String?) ?? "Mac"
        let p = Process()
        p.executableURL = executable
        p.arguments = ["--data-dir", AppPaths.syncDir.path, "--device-name", deviceName]
        let stdin = Pipe()
        let stdout = Pipe()
        p.standardInput = stdin
        p.standardOutput = stdout
        p.standardError = openLog()

        let conn = HelperConnection(output: stdin.fileHandleForWriting)
        conn.onNotification = { [weak self] method, params in self?.notification(method, params) }
        conn.onRequest = { [weak self] method, params, respond in
            guard let self else { return respond(nil, "应用正在退出") }
            self.request(method, params, respond)
        }
        stdout.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                conn.close()
            } else {
                conn.receive(data)
            }
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { self?.terminated(proc, conn) }
        }
        do {
            try p.run()
        } catch {
            NSLog("Typoza:启动同步辅助进程失败:%@", error.localizedDescription)
            return
        }
        process = p
        connection = conn
        startedAt = Date()
        resumeSession(conn)
    }

    /// 网页调用 sync.*。结果统一包成 {ok, result} 或 {ok: false, error: {code, message}},网页据错误码分支。
    func callFromWeb(_ method: String, params: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        // session.* 带密钥,只在外壳与辅助进程之间流转,网页不能调用
        guard method.hasPrefix("sync.") else {
            reply(["ok": false, "error": ["code": "forbidden", "message": "不允许调用 \(method)"]])
            return
        }
        ensureStarted()
        guard let conn = connection else {
            reply(["ok": false, "error": ["code": "unavailable", "message": "同步组件没能启动,详见 ~/Library/Logs/Typoza/helper.log"]])
            return
        }
        conn.call(method, params: params) { result in
            switch result {
            case .success(let value): reply(["ok": true, "result": value ?? NSNull()])
            case .failure(let failure): reply(["ok": false, "error": ["code": failure.code, "message": failure.message]])
            }
        }
    }

    /// 退出应用时调用:关闭管道让辅助进程停下引擎后自行退出,最多等 3 秒。
    func stop() {
        stopping = true
        guard let p = process, p.isRunning else { return }
        try? (p.standardInput as? Pipe)?.fileHandleForWriting.close()
        let deadline = Date().addingTimeInterval(3)
        while p.isRunning, Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        if p.isRunning { p.terminate() }
    }

    // ---------- 私有 ----------

    private func resumeSession(_ conn: HelperConnection) {
        keychainQueue.async {
            let data: Data?
            do {
                data = try self.keychain.read()
            } catch {
                NSLog("Typoza:读取钥匙串失败:%@", error.localizedDescription)
                return
            }
            guard let data else { return }
            guard let secrets = try? JSONSerialization.jsonObject(with: data) else {
                NSLog("Typoza:钥匙串里的同步会话已损坏,已删除")
                try? self.keychain.delete()
                return
            }
            conn.call("session.resume", params: ["secrets": secrets]) { result in
                guard case .failure(let failure) = result else { return }
                NSLog("Typoza:恢复同步会话失败:%@", failure.message)
                if failure.code == "invalid_secrets" {
                    self.keychainQueue.async { try? self.keychain.delete() }
                }
            }
        }
    }

    private func notification(_ method: String, _ params: Any?) {
        if method == "session.secrets" {
            let secrets = (params as? [String: Any])?["secrets"]
            keychainQueue.async {
                do {
                    if let secrets, !(secrets is NSNull) {
                        try self.keychain.write(try JSONSerialization.data(withJSONObject: secrets))
                    } else {
                        try self.keychain.delete()
                    }
                } catch {
                    NSLog("Typoza:更新钥匙串失败:%@", error.localizedDescription)
                }
            }
            return
        }
        guard method.hasPrefix("sync.") else { return }
        broadcast?("sync.event", ["method": method, "params": params ?? NSNull()])
    }

    private func request(_ method: String, _ params: [String: Any], _ respond: @escaping HelperConnection.Respond) {
        switch method {
        case "host.trash":
            guard let path = params["path"] as? String else { return respond(nil, "缺少参数 path") }
            do {
                try FileService.trash(path)
                respond([:], nil)
            } catch {
                respond(nil, error.localizedDescription)
            }
        default:
            respond(nil, "外壳不支持 \(method)")
        }
    }

    private func terminated(_ proc: Process, _ conn: HelperConnection) {
        conn.close()
        guard proc === process else { return }
        process = nil
        connection = nil
        if stopping { return }
        // 运行超过一分钟后才退出的算偶发,从 1 秒重新退避;刚启动就退出的逐次加倍,最多一分钟
        let delay = Date().timeIntervalSince(startedAt) > 60 ? 1 : restartDelay
        restartDelay = min(delay * 2, 60)
        NSLog("Typoza:同步辅助进程退出(状态 %d),%.0f 秒后重启", proc.terminationStatus, delay)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.ensureStarted() }
    }

    /// 辅助进程的标准错误追加到 ~/Library/Logs/Typoza/helper.log,超过 5 MB 先清空。
    private func openLog() -> FileHandle {
        let dir = AppPaths.logsDir
        let url = dir.appendingPathComponent("helper.log")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
            if size > 5 << 20 || !FileManager.default.fileExists(atPath: url.path) {
                FileManager.default.createFile(atPath: url.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: url)
            _ = try handle.seekToEnd()
            return handle
        } catch {
            NSLog("Typoza:打开辅助进程日志失败:%@", error.localizedDescription)
            return FileHandle.nullDevice
        }
    }
}
