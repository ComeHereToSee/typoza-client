import XCTest
@testable import TypozaKit

/// 偏好设置相关的外壳纯逻辑:菜单键位、导出参数、上传服务、主题文件夹。
final class MenuKeyTests: XCTestCase {
    func testParsesModifiersAndKeys() throws {
        XCTAssertEqual(try MenuKeySpec.parse("Mod-Shift-s"), MenuKeySpec(key: "s", command: true, shift: true))
        XCTAssertEqual(try MenuKeySpec.parse("Ctrl-Mod--"), MenuKeySpec(key: "-", command: true, control: true))
        XCTAssertEqual(try MenuKeySpec.parse("Mod-Alt-Shift-t"), MenuKeySpec(key: "t", command: true, shift: true, option: true))
        XCTAssertEqual(try MenuKeySpec.parse("Mod-="), MenuKeySpec(key: "=", command: true))
    }

    func testFunctionAndNamedKeys() throws {
        XCTAssertEqual(try MenuKeySpec.parse("F8")?.key, String(utf16CodeUnits: [0xF70B], count: 1))
        XCTAssertEqual(try MenuKeySpec.parse("Mod-Shift-ArrowUp")?.key, String(utf16CodeUnits: [0xF700], count: 1))
        XCTAssertEqual(try MenuKeySpec.parse("Ctrl-Mod-Space")?.key, " ")
        XCTAssertEqual(try MenuKeySpec.parse("Mod-Enter")?.key, "\r")
    }

    func testEmptyMeansNoKeyAndUnknownFails() throws {
        XCTAssertNil(try MenuKeySpec.parse(""))
        XCTAssertThrowsError(try MenuKeySpec.parse("Hyper-x"))
        XCTAssertThrowsError(try MenuKeySpec.parse("Mod-PageUpDown"))
    }
}

final class ExportOptionTests: XCTestCase {
    func testPaperSizesInPoints() throws {
        let a4 = try PaperSize.size(named: "A4", customWidthMM: 0, customHeightMM: 0)
        XCTAssertEqual(a4.width, 595.28, accuracy: 0.01)
        XCTAssertEqual(a4.height, 841.89, accuracy: 0.01)
        XCTAssertEqual(try PaperSize.size(named: "Letter", customWidthMM: 0, customHeightMM: 0).width, 612)
        let custom = try PaperSize.size(named: "custom", customWidthMM: 25.4, customHeightMM: 50.8)
        XCTAssertEqual(custom.width, 72, accuracy: 0.001)
        XCTAssertEqual(custom.height, 144, accuracy: 0.001)
        XCTAssertThrowsError(try PaperSize.size(named: "B9", customWidthMM: 0, customHeightMM: 0))
        XCTAssertThrowsError(try PaperSize.size(named: "custom", customWidthMM: 0, customHeightMM: 100))
    }

    func testExpandsVariablesAndKeepsUnknown() {
        let vars = ["title": "周报", "pageNo": "2", "pageCount": "9"]
        XCTAssertEqual(ExportVariables.expand("${title} · ${pageNo} / ${pageCount}", vars), "周报 · 2 / 9")
        XCTAssertEqual(ExportVariables.expand("${author} 写于 ${today}", vars), "${author} 写于 ${today}")
        XCTAssertEqual(ExportVariables.expand("没有结束的 ${title", vars), "没有结束的 ${title")
    }

    func testSplitsShellWords() throws {
        XCTAssertEqual(try ShellWords.split(#"--toc "a b" 'c d' e\ f"#), ["--toc", "a b", "c d", "e f"])
        XCTAssertEqual(try ShellWords.split("   "), [])
        XCTAssertEqual(try ShellWords.split(#"--metadata=title:"" x"#), ["--metadata=title:", "x"])
        XCTAssertThrowsError(try ShellWords.split(#"--css "a.css"#))
    }

    func testPandocArgumentsForBuiltinAndItems() throws {
        let docx = try PandocArguments.export(format: "docx", target: "/tmp/a.docx", sourceFolder: "/doc", options: ["referenceDoc": "/ref.docx", "args": "--toc", "author": "小明"])
        XCTAssertEqual(Array(docx.prefix(4)), ["-f", PandocArguments.inputFormat, "-t", "docx"])
        XCTAssertTrue(docx.contains("--reference-doc=/ref.docx"))
        XCTAssertTrue(docx.contains("--resource-path=/doc"))
        XCTAssertEqual(docx.last, "--toc")
        XCTAssertTrue(docx.contains("author=小明"))

        let gfm = try PandocArguments.export(format: "pandoc", target: "/tmp/a.md", sourceFolder: nil, options: ["to": "gfm", "columns": 80, "eol": "crlf", "referenceLinks": true])
        XCTAssertTrue(gfm.contains("--columns=80"))
        XCTAssertTrue(gfm.contains("--eol=crlf"))
        XCTAssertTrue(gfm.contains("--reference-links"))

        let pdf = try PandocArguments.export(format: "pandoc", target: "/tmp/a.pdf", sourceFolder: nil, options: ["to": "pdf", "pdfEngine": ""])
        XCTAssertTrue(pdf.contains("--pdf-engine=xelatex"))
        XCTAssertTrue(pdf.contains("latex"))

        XCTAssertThrowsError(try PandocArguments.export(format: "pandoc", target: "/tmp/a", sourceFolder: nil, options: [:]))
    }
}

final class ImageUploadServiceTests: XCTestCase {
    func testCommandsPerService() throws {
        XCTAssertEqual(try ImageUpload.command(for: .picgoCore, custom: ""), "picgo upload")
        XCTAssertNil(try ImageUpload.command(for: .picgoApp, custom: ""))
        XCTAssertNil(try ImageUpload.command(for: .piclist, custom: ""))
        XCTAssertEqual(try ImageUpload.command(for: .custom, custom: "  my-up  "), "my-up")
        XCTAssertThrowsError(try ImageUpload.command(for: .custom, custom: " "))
        XCTAssertThrowsError(try ImageUpload.upload(service: "ipic", command: "", paths: []))
    }

    func testParsesServerResponse() throws {
        let ok = Data(#"{"success":true,"result":["https://img.example.com/a.png"]}"#.utf8)
        XCTAssertEqual(try ImageUpload.parseServerResponse(ok, count: 1), ["https://img.example.com/a.png"])
        let failed = Data(#"{"success":false,"message":"图床未配置"}"#.utf8)
        XCTAssertThrowsError(try ImageUpload.parseServerResponse(failed, count: 1)) { error in
            XCTAssertTrue((error as? BridgeError)?.message.contains("图床未配置") == true)
        }
    }

    func testShellCommandReportsStatusAndOutput() throws {
        let r = try ShellCommand.run("echo 上传完成; echo 出错了 1>&2; exit 3", cwd: NSTemporaryDirectory())
        XCTAssertEqual(r.status, 3)
        XCTAssertTrue(r.output.contains("上传完成"))
        XCTAssertTrue(r.output.contains("出错了"))
    }

    func testDownloadsFileURL() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("typoza-dl-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let source = dir.appendingPathComponent("源.png")
        try Data([1, 2, 3]).write(to: source)
        let target = dir.appendingPathComponent("assets/图.png").path
        try FileDownload.fetch(source, to: target)
        XCTAssertEqual(FileManager.default.contents(atPath: target), Data([1, 2, 3]))
    }
}

final class ThemeFolderTests: XCTestCase {
    func testListsCustomThemesOnly() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("typoza-themes-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for name in ["dark-blue.css", "base.user.css", "github.css", "dark-blue.user.css", "notes.txt", "Academic.css"] {
            try Data().write(to: dir.appendingPathComponent(name))
        }
        XCTAssertEqual(ThemeFolder.customThemes(in: dir), ["Academic", "dark-blue"])
        XCTAssertEqual(ThemeFolder.customThemes(in: dir.appendingPathComponent("不存在")), [])
    }
}
