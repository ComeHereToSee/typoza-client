import AppKit
import TypozaKit
import WebKit

/// 原生菜单的运行期调整:自定义快捷键(偏好「快捷键」页,PRD 3.13)、导出项(对照表 PX-09)、主题菜单(T-01 ~ T-05)。
final class MenuCustomizer: NSObject, NSMenuDelegate {
    static let shared = MenuCustomizer()

    /// 菜单项出厂键位(第一次改动前记下),恢复默认时用
    private var originals: [ObjectIdentifier: (key: String, mask: NSEvent.ModifierFlags, hidden: Bool)] = [:]
    private let exportItemTag = 7311

    private func allItems(_ menu: NSMenu) -> [NSMenuItem] {
        var out: [NSMenuItem] = []
        for item in menu.items {
            out.append(item)
            if let submenu = item.submenu { out += allItems(submenu) }
        }
        return out
    }

    /// overrides:命令 ID → 网页键名(空串 = 无键位);不在表里的菜单项恢复出厂键位。键名认不出来时整批不改,直接报错。
    func applyKeys(_ overrides: [String: String]) throws {
        guard let main = NSApp.mainMenu else { return }
        var specs: [String: MenuKeySpec?] = [:]
        for (id, name) in overrides { specs[id] = try MenuKeySpec.parse(name) }
        for item in allItems(main) {
            guard let id = item.representedObject as? String else { continue }
            let oid = ObjectIdentifier(item)
            if originals[oid] == nil { originals[oid] = (item.keyEquivalent, item.keyEquivalentModifierMask, item.isHidden) }
            if let entry = specs[id] {
                // 「放大」等的别名项(⇧⌘=)是交替菜单项,改了主键位后藏起来,避免两个项抢同一个键
                if item.isAlternate {
                    item.isHidden = true
                    item.keyEquivalent = ""
                    item.keyEquivalentModifierMask = []
                    continue
                }
                item.keyEquivalent = entry?.key ?? ""
                item.keyEquivalentModifierMask = entry.map(Self.flags) ?? []
            } else if let original = originals[oid] {
                item.keyEquivalent = original.key
                item.keyEquivalentModifierMask = original.mask
                item.isHidden = original.hidden
            }
        }
    }

    private static func flags(_ spec: MenuKeySpec) -> NSEvent.ModifierFlags {
        var flags: NSEvent.ModifierFlags = []
        if spec.command { flags.insert(.command) }
        if spec.shift { flags.insert(.shift) }
        if spec.option { flags.insert(.option) }
        if spec.control { flags.insert(.control) }
        return flags
    }

    /// 文件 ▸ 导出 菜单末尾的用户导出项;点选时把 file.export.item.<ID> 发给当前窗口
    func setExportItems(_ items: [(id: String, name: String)]) {
        guard let exportMenu = NSApp.mainMenu?.item(withTitle: "文件")?.submenu?.item(withTitle: "导出")?.submenu else { return }
        for item in exportMenu.items where item.tag == exportItemTag { exportMenu.removeItem(item) }
        guard !items.isEmpty else { return }
        let separator = NSMenuItem.separator()
        separator.tag = exportItemTag
        exportMenu.addItem(separator)
        for (id, name) in items {
            let item = MainMenu.cmd(name.isEmpty ? "未命名导出项" : name, "file.export.item.\(id)")
            item.tag = exportItemTag
            exportMenu.addItem(item)
        }
    }

    // ---------- 主题菜单:每次打开时重建,主题文件夹里新放的 css 无需重启即出现(T-02) ----------

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let current = currentTheme()
        for (id, label) in ThemeFolder.builtin {
            let item = MainMenu.cmd(label, "theme.\(id)")
            item.state = id == current ? .on : .off
            menu.addItem(item)
        }
        let custom = ThemeFolder.customThemes(in: ThemeFolder.directory)
        if !custom.isEmpty {
            menu.addItem(.separator())
            for name in custom {
                let item = MainMenu.cmd(name, "theme.\(name)")
                item.state = name == current ? .on : .off
                menu.addItem(item)
            }
        }
        menu.addItem(.separator())
        menu.addItem(MainMenu.cmd("打开主题文件夹", "theme.openFolder"))
    }

    /// 正在用的主题:深色模式下是「深色模式主题」(T-06)
    private func currentTheme() -> String {
        guard let app = NSApp.delegate as? AppDelegate else { return "" }
        let settings: [String: Any]
        do {
            settings = try app.settings.load()
        } catch {
            NSLog("Typoza:读取偏好设置失败:%@", "\(error)")
            return ""
        }
        let appearance = settings["appearance"] as? String ?? "system"
        let dark = appearance == "dark" || (appearance == "system" && app.isDark)
        return dark ? (settings["darkTheme"] as? String ?? "night") : (settings["theme"] as? String ?? "github")
    }
}

/// 截下从 Finder 拖进窗口的文件:网页里拿不到文件路径,外壳把真实路径与落点交给网页按类型处理(PRD 3.5、对照表 PF-08 ~ PF-10)。
/// 拖动的不是文件(网页内拖块、从浏览器拖图片)照常交给 WKWebView。
final class DropWebView: WKWebView {
    var onFileDrop: ((_ paths: [String], _ point: NSPoint) -> Void)?

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        guard let onFileDrop, !urls.isEmpty else { return super.performDragOperation(sender) }
        // 先让网页收尾这次拖动(清掉落点指示),再交给网页按路径处理
        super.draggingExited(sender)
        let local = convert(sender.draggingLocation, from: nil)
        onFileDrop(urls.map(\.path), NSPoint(x: local.x, y: isFlipped ? local.y : bounds.height - local.y))
        return true
    }
}
