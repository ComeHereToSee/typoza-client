import Foundation
import XCTest
@testable import TypozaKit

final class HelperConnectionTests: XCTestCase {
    private let queue = DispatchQueue(label: "test.callbacks")

    /// 读出连接写给辅助进程的下一行 JSON。
    private func nextMessage(_ pipe: Pipe, file: StaticString = #filePath, line: UInt = #line) throws -> [String: Any] {
        var data = Data()
        while true {
            let byte = pipe.fileHandleForReading.readData(ofLength: 1)
            XCTAssertFalse(byte.isEmpty, "管道提前关闭", file: file, line: line)
            if byte.isEmpty || byte.first == UInt8(ascii: "\n") { break }
            data.append(byte)
        }
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any], file: file, line: line)
    }

    private func feed(_ conn: HelperConnection, _ object: [String: Any]) throws {
        var data = try JSONSerialization.data(withJSONObject: object)
        data.append(UInt8(ascii: "\n"))
        conn.receive(data)
    }

    func testCallMatchesResponsesById() throws {
        let pipe = Pipe()
        let conn = HelperConnection(output: pipe.fileHandleForWriting, callbackQueue: queue)
        let first = expectation(description: "第一次调用")
        let second = expectation(description: "第二次调用")
        conn.call("sync.status", params: [:]) { result in
            guard case .success(let value) = result, let dict = value as? [String: Any] else { return XCTFail("应成功:\(result)") }
            XCTAssertEqual(dict["signedIn"] as? Bool, false)
            first.fulfill()
        }
        conn.call("sync.login", params: ["email": "a@example.com"]) { result in
            guard case .failure(let failure) = result else { return XCTFail("应失败") }
            XCTAssertEqual(failure, HelperConnection.Failure(code: "totp_required", message: "请输入两步验证码"))
            second.fulfill()
        }
        let m1 = try nextMessage(pipe)
        let m2 = try nextMessage(pipe)
        XCTAssertEqual(m1["method"] as? String, "sync.status")
        XCTAssertEqual(m1["jsonrpc"] as? String, "2.0")
        XCTAssertEqual((m2["params"] as? [String: Any])?["email"] as? String, "a@example.com")
        // 倒序回复,且第二条拆成两段送达
        let errorReply: [String: Any] = ["jsonrpc": "2.0", "id": m2["id"]!, "error": ["code": -32000, "message": "请输入两步验证码", "data": ["code": "totp_required"]] as [String: Any]]
        var reply = try JSONSerialization.data(withJSONObject: errorReply)
        reply.append(UInt8(ascii: "\n"))
        try feed(conn, ["jsonrpc": "2.0", "id": m1["id"]!, "result": ["signedIn": false]])
        conn.receive(reply.prefix(10))
        conn.receive(reply.dropFirst(10))
        wait(for: [first, second], timeout: 5)
    }

    func testNotificationsAndRequestsFromHelper() throws {
        let pipe = Pipe()
        let conn = HelperConnection(output: pipe.fileHandleForWriting, callbackQueue: queue)
        let notified = expectation(description: "通知")
        conn.onNotification = { method, params in
            XCTAssertEqual(method, "sync.event")
            XCTAssertEqual((params as? [String: Any])?["kind"] as? String, "synced")
            notified.fulfill()
        }
        conn.onRequest = { method, params, respond in
            XCTAssertEqual(method, "host.trash")
            if params["path"] as? String == "/坏/路径" {
                respond(nil, "文件不存在")
            } else {
                respond(["done": true], nil)
            }
        }
        try feed(conn, ["jsonrpc": "2.0", "method": "sync.event", "params": ["kind": "synced"]])
        try feed(conn, ["jsonrpc": "2.0", "id": "h1", "method": "host.trash", "params": ["path": "/a.md"]])
        try feed(conn, ["jsonrpc": "2.0", "id": "h2", "method": "host.trash", "params": ["path": "/坏/路径"]])
        wait(for: [notified], timeout: 5)
        let r1 = try nextMessage(pipe)
        let r2 = try nextMessage(pipe)
        let byID = [r1["id"] as? String: r1, r2["id"] as? String: r2]
        XCTAssertEqual((byID["h1"]?["result"] as? [String: Any])?["done"] as? Bool, true)
        XCTAssertEqual((byID["h2"]?["error"] as? [String: Any])?["message"] as? String, "文件不存在")
        XCTAssertNil(byID["h2"]?["result"])
    }

    func testCloseFailsPendingAndLaterCalls() throws {
        let pipe = Pipe()
        let conn = HelperConnection(output: pipe.fileHandleForWriting, callbackQueue: queue)
        let pending = expectation(description: "等待中的调用")
        conn.call("sync.now", params: [:]) { result in
            guard case .failure(let failure) = result else { return XCTFail("应失败") }
            XCTAssertEqual(failure.code, "closed")
            pending.fulfill()
        }
        _ = try nextMessage(pipe)
        conn.close()
        wait(for: [pending], timeout: 5)
        let later = expectation(description: "关闭后的调用")
        conn.call("sync.status", params: [:]) { result in
            if case .failure(let failure) = result, failure.code == "closed" { later.fulfill() }
        }
        wait(for: [later], timeout: 5)
    }

    func testIgnoresGarbageAndUnknownResponses() throws {
        let pipe = Pipe()
        let conn = HelperConnection(output: pipe.fileHandleForWriting, callbackQueue: queue)
        let done = expectation(description: "调用")
        conn.call("sync.status", params: [:]) { result in
            if case .success = result { done.fulfill() }
        }
        let m = try nextMessage(pipe)
        conn.receive(Data("这不是 JSON\n\n".utf8))
        try feed(conn, ["jsonrpc": "2.0", "id": 9999, "result": [String: Any]()])
        try feed(conn, ["jsonrpc": "2.0", "id": m["id"]!, "result": NSNull()])
        wait(for: [done], timeout: 5)
    }
}

final class KeychainTests: XCTestCase {
    func testWriteReadOverwriteDelete() throws {
        let item = KeychainItem(service: "app.typoza.tests.\(UUID().uuidString)", account: "session")
        defer { try? item.delete() }
        XCTAssertNil(try item.read())
        try item.write(Data("第一份".utf8))
        XCTAssertEqual(try item.read(), Data("第一份".utf8))
        try item.write(Data("第二份".utf8))
        XCTAssertEqual(try item.read(), Data("第二份".utf8))
        try item.delete()
        XCTAssertNil(try item.read())
        try item.delete() // 不存在时删除不报错
    }
}
