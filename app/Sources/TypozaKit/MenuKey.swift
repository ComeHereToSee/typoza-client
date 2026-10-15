import Foundation

/// 菜单快捷键:网页键名(prosemirror-keymap 写法,如 Mod-Shift-s、Ctrl-Mod-ArrowUp、F8)→ 菜单项的 keyEquivalent 与修饰键。
/// 偏好「快捷键」页改了键位后,网页把新键名发来,外壳据此改菜单项(PRD 3.13)。
public struct MenuKeySpec: Equatable {
    /// NSMenuItem.keyEquivalent
    public let key: String
    public let command: Bool
    public let shift: Bool
    public let option: Bool
    public let control: Bool

    public init(key: String, command: Bool = false, shift: Bool = false, option: Bool = false, control: Bool = false) {
        self.key = key
        self.command = command
        self.shift = shift
        self.option = option
        self.control = control
    }

    /// 空串表示没有键位,返回 nil;认不出的修饰键或按键直接报错。
    public static func parse(_ name: String) throws -> MenuKeySpec? {
        if name.isEmpty { return nil }
        let keyPart: String
        let modPart: String
        // 键本身是减号:Mod-- / Ctrl--
        if name == "-" {
            keyPart = "-"
            modPart = ""
        } else if name.hasSuffix("--") {
            keyPart = "-"
            modPart = String(name.dropLast(2))
        } else if let i = name.lastIndex(of: "-") {
            keyPart = String(name[name.index(after: i)...])
            modPart = String(name[..<i])
        } else {
            keyPart = name
            modPart = ""
        }
        var command = false
        var shift = false
        var option = false
        var control = false
        for m in modPart.split(separator: "-") {
            switch m.lowercased() {
            case "mod", "cmd", "meta", "m": command = true
            case "shift", "s": shift = true
            case "alt", "option", "a": option = true
            case "ctrl", "control", "c": control = true
            default: throw BridgeError("无法识别的修饰键「\(m)」(键位 \(name))")
            }
        }
        return MenuKeySpec(key: try keyEquivalent(keyPart, in: name), command: command, shift: shift, option: option, control: control)
    }

    // AppKit 的功能键码(NSUpArrowFunctionKey 等)
    private static func functionKey(_ code: Int) -> String {
        String(utf16CodeUnits: [UInt16(code)], count: 1)
    }

    static func keyEquivalent(_ key: String, in name: String) throws -> String {
        switch key {
        case "ArrowUp": return functionKey(0xF700)
        case "ArrowDown": return functionKey(0xF701)
        case "ArrowLeft": return functionKey(0xF702)
        case "ArrowRight": return functionKey(0xF703)
        case "Delete": return functionKey(0xF728)
        case "Backspace": return "\u{8}"
        case "Enter": return "\r"
        case "Tab": return "\t"
        case "Escape": return "\u{1b}"
        case "Space": return " "
        default:
            if key.count == 1 { return key.lowercased() }
            if key.hasPrefix("F"), let n = Int(key.dropFirst()), (1 ... 20).contains(n) { return functionKey(0xF704 + n - 1) }
            throw BridgeError("无法识别的按键「\(key)」(键位 \(name))")
        }
    }
}
