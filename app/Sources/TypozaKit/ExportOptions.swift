import Foundation

/// 导出参数里的纯逻辑(偏好「导出」页,对照表 PX-04、PX-07、PX-08、X-23):纸张尺寸、变量替换、Pandoc 参数。
public enum PaperSize {
    /// 毫米 → 点(PDF 的单位,1 英寸 = 72 点 = 25.4 毫米)
    public static func points(fromMillimeters mm: Double) -> Double {
        mm * 72 / 25.4
    }

    /// 纸张大小(点);custom 用给定的宽高(毫米),不认识的名字报错
    public static func size(named name: String, customWidthMM: Double, customHeightMM: Double) throws -> (width: Double, height: Double) {
        switch name {
        case "A3": return (points(fromMillimeters: 297), points(fromMillimeters: 420))
        case "A4": return (points(fromMillimeters: 210), points(fromMillimeters: 297))
        case "A5": return (points(fromMillimeters: 148), points(fromMillimeters: 210))
        case "Letter": return (612, 792)
        case "Legal": return (612, 1008)
        case "Tabloid": return (792, 1224)
        case "custom":
            guard customWidthMM > 0, customHeightMM > 0 else { throw BridgeError("自定义纸张的宽和高要大于 0") }
            return (points(fromMillimeters: customWidthMM), points(fromMillimeters: customHeightMM))
        default:
            throw BridgeError("不支持的纸张大小:\(name)")
        }
    }
}

public enum ExportVariables {
    /// 替换 ${变量};不认识的变量原样保留
    public static func expand(_ template: String, _ vars: [String: String]) -> String {
        var out = ""
        var rest = Substring(template)
        while let start = rest.range(of: "${") {
            out += rest[..<start.lowerBound]
            let after = rest[start.upperBound...]
            guard let end = after.firstIndex(of: "}") else {
                out += rest[start.lowerBound...]
                return out
            }
            let name = String(after[..<end])
            if let value = vars[name] { out += value } else { out += "${\(name)}" }
            rest = after[after.index(after: end)...]
        }
        return out + rest
    }
}

public enum ShellWords {
    /// 按 shell 规则把一串参数拆开(支持单双引号与反斜杠转义),给 Pandoc 的「额外参数」用;引号没闭合报错
    public static func split(_ text: String) throws -> [String] {
        var words: [String] = []
        var current = ""
        var inWord = false
        var quote: Character?
        var escaped = false
        for ch in text {
            if escaped {
                current.append(ch)
                escaped = false
                continue
            }
            if ch == "\\" && quote != "'" {
                escaped = true
                inWord = true
                continue
            }
            if let q = quote {
                if ch == q { quote = nil } else { current.append(ch) }
                continue
            }
            if ch == "\"" || ch == "'" {
                quote = ch
                inWord = true
            } else if ch.isWhitespace {
                if inWord { words.append(current) }
                current = ""
                inWord = false
            } else {
                current.append(ch)
                inWord = true
            }
        }
        if quote != nil || escaped { throw BridgeError("Pandoc 参数里的引号或转义没有结束:\(text)") }
        if inWord { words.append(current) }
        return words
    }
}

/// 导出用的 Pandoc 命令行参数(不含输入,输入经标准输入给 Markdown)。
public enum PandocArguments {
    /// 读 Typoza 存的 Markdown(GFM + 数学 + Typora 扩展)
    public static let inputFormat = "markdown+tex_math_dollars+pipe_tables+task_lists+strikeout+superscript+subscript+mark"

    public static func export(format: String, target: String, sourceFolder: String?, options: [String: Any]) throws -> [String] {
        let string = { (key: String) in (options[key] as? String) ?? "" }
        let number = { (key: String) in (options[key] as? NSNumber)?.intValue ?? 0 }
        let flag = { (key: String) in (options[key] as? Bool) ?? (options[key] as? NSNumber)?.boolValue ?? false }
        var args = ["-f", inputFormat]
        var to = format
        if format == "pandoc" {
            to = string("to")
            guard !to.isEmpty else { throw BridgeError("导出项没有填写 Pandoc 目标格式") }
        }
        if to == "pdf" {
            // Pandoc 经 LaTeX 生成 PDF,由 -o 的扩展名决定;引擎可选
            args += ["-t", "latex", "--pdf-engine=\(string("pdfEngine").isEmpty ? "xelatex" : string("pdfEngine"))"]
        } else {
            args += ["-t", to]
        }
        args += ["-o", target, "--standalone"]
        if let sourceFolder { args.append("--resource-path=\(sourceFolder)") }
        if !string("referenceDoc").isEmpty { args.append("--reference-doc=\(string("referenceDoc"))") }
        if !string("css").isEmpty { args.append("--css=\(string("css"))") }
        if number("tocDepth") > 0 { args += ["--toc", "--toc-depth=\(number("tocDepth"))"] }
        if !string("author").isEmpty { args += ["-M", "author=\(string("author"))"] }
        // Epub 必须有标题
        if to == "epub", !string("title").isEmpty { args += ["-M", "title=\(string("title"))"] }
        if to.hasPrefix("markdown") || to.hasPrefix("commonmark") || to == "gfm" {
            let columns = number("columns")
            args += columns > 0 ? ["--wrap=auto", "--columns=\(columns)"] : ["--wrap=none"]
            let eol = string("eol")
            if !eol.isEmpty { args.append("--eol=\(eol)") }
            if flag("referenceLinks") { args.append("--reference-links") }
            if flag("ascii") { args.append("--ascii") }
        }
        args += try ShellWords.split(string("args"))
        return args
    }
}
