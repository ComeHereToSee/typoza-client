import Foundation

/// 回给网页的错误:message 原样成为 JS 端 Promise 的拒绝原因,所以写成用户能看懂的中文。
public struct BridgeError: Error, LocalizedError, Equatable {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var errorDescription: String? { message }
}

/// 桥接参数读取:类型不对直接报错并指明字段,不做静默兜底。
public struct Params {
    public let raw: [String: Any]

    public init(_ raw: [String: Any]) {
        self.raw = raw
    }

    public func string(_ key: String) throws -> String {
        guard let v = raw[key] as? String else { throw BridgeError("参数 \(key) 缺失或不是字符串") }
        return v
    }

    public func optionalString(_ key: String) -> String? {
        raw[key] as? String
    }

    public func bool(_ key: String, default value: Bool = false) -> Bool {
        (raw[key] as? Bool) ?? (raw[key] as? NSNumber)?.boolValue ?? value
    }

    public func int(_ key: String, default value: Int) -> Int {
        (raw[key] as? NSNumber)?.intValue ?? value
    }

    public func strings(_ key: String) -> [String] {
        (raw[key] as? [Any])?.compactMap { $0 as? String } ?? []
    }

    public func dictionary(_ key: String) -> [String: Any] {
        (raw[key] as? [String: Any]) ?? [:]
    }
}
