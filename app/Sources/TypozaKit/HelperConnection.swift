import Foundation

/// 与同步辅助进程之间的 JSON-RPC 2.0 连接:每行一条 JSON 消息,双向。
/// 只负责收发与配对;进程的启动、重启由外壳负责。所有回调在 callbackQueue 上执行。
public final class HelperConnection {
    /// 辅助进程返回的错误;code 取自 error.data.code(业务错误码),没有时为 "rpc";管道关闭为 "closed"。
    public struct Failure: Error, LocalizedError, Equatable {
        public let code: String
        public let message: String

        public init(code: String, message: String) {
            self.code = code
            self.message = message
        }

        public var errorDescription: String? { message }
    }

    public typealias Completion = (Result<Any?, Failure>) -> Void
    /// 回复辅助进程的请求:(结果, 错误说明),错误说明非空表示失败。
    public typealias Respond = (Any?, String?) -> Void

    /// 辅助进程推来的通知(method, params)。
    public var onNotification: ((String, Any?) -> Void)?
    /// 辅助进程发来的请求(如把文件移进废纸篓)。
    public var onRequest: ((String, [String: Any], @escaping Respond) -> Void)?

    private let output: FileHandle
    private let callbackQueue: DispatchQueue
    // 以下状态只在 queue 上读写
    private let queue = DispatchQueue(label: "app.typoza.helper.connection")
    private var nextID = 1
    private var pending: [Int: Completion] = [:]
    private var buffer = Data()
    private var closed = false

    /// output 是辅助进程的标准输入。
    public init(output: FileHandle, callbackQueue: DispatchQueue = .main) {
        self.output = output
        self.callbackQueue = callbackQueue
    }

    /// 调用辅助进程的方法。
    public func call(_ method: String, params: [String: Any], completion: @escaping Completion) {
        queue.async {
            if self.closed {
                self.callbackQueue.async { completion(.failure(Failure(code: "closed", message: "同步组件已退出"))) }
                return
            }
            let id = self.nextID
            self.nextID += 1
            self.pending[id] = completion
            if let error = self.send(["jsonrpc": "2.0", "id": id, "method": method, "params": params]) {
                self.pending[id] = nil
                self.callbackQueue.async { completion(.failure(error)) }
            }
        }
    }

    /// 交给连接从辅助进程标准输出读到的数据(可以是任意分片)。
    public func receive(_ data: Data) {
        queue.async {
            self.buffer.append(data)
            while let nl = self.buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let line = self.buffer.subdata(in: self.buffer.startIndex ..< nl)
                self.buffer.removeSubrange(self.buffer.startIndex ... nl)
                if !line.isEmpty { self.handle(line) }
            }
        }
    }

    /// 管道已关闭(辅助进程退出):未完成的调用全部失败。
    public func close() {
        queue.async {
            guard !self.closed else { return }
            self.closed = true
            let waiting = self.pending
            self.pending.removeAll()
            for (_, completion) in waiting {
                self.callbackQueue.async { completion(.failure(Failure(code: "closed", message: "同步组件已退出"))) }
            }
        }
    }

    // ---------- 以下在 queue 上执行 ----------

    private func handle(_ line: Data) {
        guard let msg = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else {
            NSLog("Typoza:辅助进程输出了无法解析的一行:%@", String(decoding: line.prefix(200), as: UTF8.self))
            return
        }
        if let method = msg["method"] as? String {
            let params = msg["params"] is NSNull ? nil : msg["params"]
            if let id = msg["id"], !(id is NSNull) {
                let respond: Respond = { [weak self] result, error in
                    self?.queue.async {
                        var reply: [String: Any] = ["jsonrpc": "2.0", "id": id]
                        if let error {
                            reply["error"] = ["code": -32000, "message": error]
                        } else {
                            reply["result"] = result ?? NSNull()
                        }
                        _ = self?.send(reply)
                    }
                }
                callbackQueue.async {
                    if let handler = self.onRequest {
                        handler(method, (params as? [String: Any]) ?? [:], respond)
                    } else {
                        respond(nil, "外壳不支持 \(method)")
                    }
                }
            } else {
                callbackQueue.async { self.onNotification?(method, params) }
            }
            return
        }
        guard let id = (msg["id"] as? NSNumber)?.intValue, let completion = pending.removeValue(forKey: id) else { return }
        if let error = msg["error"] as? [String: Any] {
            let code = ((error["data"] as? [String: Any])?["code"] as? String) ?? "rpc"
            let message = (error["message"] as? String) ?? "同步组件返回了未知错误"
            callbackQueue.async { completion(.failure(Failure(code: code, message: message))) }
        } else {
            let result = msg["result"].flatMap { $0 is NSNull ? nil : $0 }
            callbackQueue.async { completion(.success(result)) }
        }
    }

    private func send(_ object: [String: Any]) -> Failure? {
        do {
            var data = try JSONSerialization.data(withJSONObject: object)
            data.append(UInt8(ascii: "\n"))
            try output.write(contentsOf: data)
            return nil
        } catch {
            return Failure(code: "closed", message: "无法写入同步组件:\(error.localizedDescription)")
        }
    }
}
