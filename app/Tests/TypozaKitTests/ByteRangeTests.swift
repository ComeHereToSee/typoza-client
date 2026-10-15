import XCTest
@testable import TypozaKit

final class ByteRangeTests: XCTestCase {
    func testNoHeaderServesFull() {
        XCTAssertEqual(ByteRange.parse(nil, size: 100, maxChunk: 50), .full)
    }

    func testOpenEndedRangeIsCappedToChunk() {
        XCTAssertEqual(ByteRange.parse("bytes=0-", size: 100, maxChunk: 40), .partial(start: 0, end: 39))
    }

    func testClosedRangeClampedToFileEnd() {
        XCTAssertEqual(ByteRange.parse("bytes=90-200", size: 100, maxChunk: 1000), .partial(start: 90, end: 99))
    }

    func testSuffixRange() {
        XCTAssertEqual(ByteRange.parse("bytes=-10", size: 100, maxChunk: 1000), .partial(start: 90, end: 99))
    }

    func testStartBeyondEndIsUnsatisfiable() {
        XCTAssertEqual(ByteRange.parse("bytes=100-", size: 100, maxChunk: 1000), .unsatisfiable)
    }

    func testMultiRangeUsesFirst() {
        XCTAssertEqual(ByteRange.parse("bytes=0-9,20-29", size: 100, maxChunk: 1000), .partial(start: 0, end: 9))
    }

    func testMimeForEditorAssets() {
        XCTAssertTrue(MimeType.forExtension("js").hasPrefix("text/javascript"))
        XCTAssertEqual(MimeType.forExtension("PNG"), "image/png")
    }
}
