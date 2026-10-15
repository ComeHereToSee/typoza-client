import Foundation

/// 文本编码识别与转换。名字与网页侧约定一致:utf-8 / utf-16le / utf-16be / gb18030 / big5 / shift_jis / euc-kr / windows-1252。
public enum TextEncoding {
    public static func encoding(named name: String) throws -> String.Encoding {
        switch name.lowercased() {
        case "utf-8", "utf8": return .utf8
        case "utf-16le": return .utf16LittleEndian
        case "utf-16be": return .utf16BigEndian
        case "gb18030", "gbk", "gb2312": return cf(.GB_18030_2000)
        case "big5": return cf(.big5)
        case "shift_jis", "shift-jis", "sjis": return .shiftJIS
        case "euc-kr": return cf(.EUC_KR)
        case "windows-1252", "cp1252": return .windowsCP1252
        case "iso-8859-1", "latin1": return .isoLatin1
        default: throw BridgeError("不支持的编码:\(name)")
        }
    }

    private static func cf(_ e: CFStringEncodings) -> String.Encoding {
        String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(e.rawValue)))
    }

    /// 解码文件内容。有 BOM 时按 BOM,并在结果开头保留 U+FEFF(网页侧据此记住「带 BOM」并原样写回)。
    /// 无 BOM:严格 UTF-8 → GB18030(中文旧文件最常见)→ Latin-1(任何字节都能解,保证打得开)。
    public static func decode(_ data: Data, preferred: String? = nil) throws -> (text: String, encoding: String) {
        if let preferred {
            let enc = try encoding(named: preferred)
            guard let text = String(data: stripBOM(data, for: preferred), encoding: enc) else {
                throw BridgeError("无法用 \(preferred) 解码这个文件")
            }
            return (hasBOM(data) ? "\u{FEFF}" + text : text, preferred)
        }
        let bytes = [UInt8](data.prefix(3))
        if bytes.count >= 3, bytes[0] == 0xEF, bytes[1] == 0xBB, bytes[2] == 0xBF {
            guard let text = String(data: data.dropFirst(3), encoding: .utf8) else { throw BridgeError("文件带 UTF-8 BOM 但内容不是合法 UTF-8") }
            return ("\u{FEFF}" + text, "utf-8")
        }
        if bytes.count >= 2, bytes[0] == 0xFF, bytes[1] == 0xFE {
            guard let text = String(data: data.dropFirst(2), encoding: .utf16LittleEndian) else { throw BridgeError("UTF-16LE 解码失败") }
            return ("\u{FEFF}" + text, "utf-16le")
        }
        if bytes.count >= 2, bytes[0] == 0xFE, bytes[1] == 0xFF {
            guard let text = String(data: data.dropFirst(2), encoding: .utf16BigEndian) else { throw BridgeError("UTF-16BE 解码失败") }
            return ("\u{FEFF}" + text, "utf-16be")
        }
        if let text = String(data: data, encoding: .utf8) { return (text, "utf-8") }
        if let text = String(data: data, encoding: try encoding(named: "gb18030")) { return (text, "gb18030") }
        guard let text = String(data: data, encoding: .isoLatin1) else { throw BridgeError("无法识别文件编码") }
        return (text, "iso-8859-1")
    }

    private static func hasBOM(_ data: Data) -> Bool {
        let b = [UInt8](data.prefix(3))
        return (b.count >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF) || (b.count >= 2 && ((b[0] == 0xFF && b[1] == 0xFE) || (b[0] == 0xFE && b[1] == 0xFF)))
    }

    private static func stripBOM(_ data: Data, for name: String) -> Data {
        let b = [UInt8](data.prefix(3))
        if name.lowercased().hasPrefix("utf-8"), b.count >= 3, b[0] == 0xEF, b[1] == 0xBB, b[2] == 0xBF { return data.dropFirst(3) }
        if name.lowercased().hasPrefix("utf-16"), b.count >= 2, (b[0] == 0xFF && b[1] == 0xFE) || (b[0] == 0xFE && b[1] == 0xFF) { return data.dropFirst(2) }
        return data
    }

    /// 编码文本;文本开头的 U+FEFF 会按目标编码写成对应的 BOM。
    public static func encode(_ text: String, as name: String) throws -> Data {
        let enc = try encoding(named: name)
        guard let data = text.data(using: enc, allowLossyConversion: false) else {
            throw BridgeError("内容里有 \(name) 无法表示的字符,请改用 UTF-8 保存")
        }
        return data
    }
}
