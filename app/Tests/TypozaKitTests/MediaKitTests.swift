import AppKit
import XCTest
@testable import TypozaKit

final class EmbedPolicyTests: XCTestCase {
    func testNoFramingHeadersAllowsEmbed() {
        XCTAssertEqual(EmbedPolicy.evaluate(statusCode: 200, headers: ["Content-Type": "text/html"]), .ok)
    }

    func testXFrameOptionsRefuses() {
        XCTAssertEqual(EmbedPolicy.evaluate(statusCode: 200, headers: ["X-Frame-Options": "SAMEORIGIN"]), .refused)
        // 响应头名不区分大小写
        XCTAssertEqual(EmbedPolicy.evaluate(statusCode: 200, headers: ["x-frame-options": "DENY"]), .refused)
    }

    func testFrameAncestorsWithoutWildcardRefuses() {
        let headers = ["Content-Security-Policy": "default-src 'self'; frame-ancestors 'self' https://a.example"]
        XCTAssertEqual(EmbedPolicy.evaluate(statusCode: 200, headers: headers), .refused)
    }

    func testFrameAncestorsWildcardAllows() {
        let headers = ["Content-Security-Policy": "frame-ancestors *; img-src *"]
        XCTAssertEqual(EmbedPolicy.evaluate(statusCode: 200, headers: headers), .ok)
    }

    func testAnyOfMergedPoliciesRestricting() {
        let headers = ["Content-Security-Policy": "img-src *, frame-ancestors 'none'"]
        XCTAssertEqual(EmbedPolicy.evaluate(statusCode: 200, headers: headers), .refused)
    }

    func testServerErrorIsUnreachable() {
        XCTAssertEqual(EmbedPolicy.evaluate(statusCode: 404, headers: [:]), .unreachable)
        XCTAssertEqual(EmbedPolicy.evaluate(statusCode: 503, headers: [:]), .unreachable)
    }
}

final class RichTextTests: XCTestCase {
    func testHTMLToRTFKeepsTextAndBold() throws {
        let data = try RichText.rtf(fromHTML: "<p><strong>加粗</strong>正文</p>")
        let rtf = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(rtf.hasPrefix("{\\rtf1"), rtf)
        XCTAssertTrue(rtf.contains("\\b"), "加粗应写成 RTF 的 \\b:\(rtf)")
        // 读回来文字不变(中文在 RTF 里是转义序列,不能直接查字符串)
        let back = try NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil)
        XCTAssertEqual(back.string.trimmingCharacters(in: .whitespacesAndNewlines), "加粗正文")
    }
}
