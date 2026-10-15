import AppKit
import TypozaKit
import WebKit

/// 应用主控:窗口(一个窗口一个文档)、菜单、最近文件、退出确认。
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let launchUptime: TimeInterval
    let smokeOut: URL?
    let settings = SettingsStore()
    let history = HistoryStore()
    let helper = HelperManager()
    private(set) var windows: [DocumentWindowController] = []
    private var closedPaths: [String] = []
    private let recentMenu = NSMenu(title: "打开最近使用")
    private var appearanceObservation: NSKeyValueObservation?

    /// 启动各阶段相对进程起点的秒数(冒烟报告里分析冷启动用)
    private(set) var launchMarks: [String: Double] = [:]

    /// 进程创建到 main 开始执行的秒数(动态库加载等);取不到时为 nil
    var preMainSeconds: Double? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
        let start = info.kp_proc.p_un.__p_starttime
        let startMs = Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
        return ((launchEpochMs - startMs) / 1000 * 1000).rounded() / 1000
    }

    func mark(_ name: String) {
        guard launchMarks[name] == nil else { return }
        launchMarks[name] = ((ProcessInfo.processInfo.systemUptime - launchUptime) * 1000).rounded() / 1000
    }

    let launchEpochMs: Double

    init(launchUptime: TimeInterval, launchEpochMs: Double) {
        self.launchUptime = launchUptime
        self.launchEpochMs = launchEpochMs
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--smoke-out"), i + 1 < args.count {
            smokeOut = URL(fileURLWithPath: args[i + 1], isDirectory: true)
        } else {
            smokeOut = nil
        }
        super.init()
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        mark("willFinishLaunching")
        recentMenu.delegate = self
        NSApp.mainMenu = MainMenu.build(recentMenu: recentMenu, windowMenu: NSMenu(title: "窗口"), helpMenu: NSMenu(title: "帮助"))
        NSApp.windowsMenu = NSApp.mainMenu?.item(withTitle: "窗口")?.submenu
        NSApp.helpMenu = NSApp.mainMenu?.item(withTitle: "帮助")?.submenu
        NSWindow.allowsAutomaticWindowTabbing = true
        // 首个窗口在这里就建,不等 didFinishLaunching:网页进程的启动与 AppKit 余下的启动并行,冷启动约快 0.15 秒。
        // 随后 Finder 传来的文件(application(_:open:))会直接用这个空白窗口打开。
        let paths = commandLinePaths()
        if paths.isEmpty {
            newWindow(open: nil)
        } else {
            for (path, isDir) in paths { open(path: path, isDir: isDir, newWindow: true) }
        }
    }

    /// 命令行直接传入的文件(开发调试用):typoza <路径>;--smoke-out 后面的输出目录不算
    private func commandLinePaths() -> [(String, Bool)] {
        var args = Array(CommandLine.arguments.dropFirst())
        if let i = args.firstIndex(of: "--smoke-out") { args.removeSubrange(i ..< min(i + 2, args.count)) }
        return args.compactMap { arg in
            var isDir: ObjCBool = false
            guard !arg.hasPrefix("-"), FileManager.default.fileExists(atPath: arg, isDirectory: &isDir) else { return nil }
            return (arg, isDir.boolValue)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        mark("didFinishLaunching")
        helper.broadcast = { [weak self] event, payload in
            self?.windows.forEach { $0.emit(event, payload) }
        }
        if smokeOut == nil { helper.startIfConfigured() }
        appearanceObservation = NSApp.observe(\.effectiveAppearance) { [weak self] app, _ in
            let dark = app.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            self?.windows.forEach { $0.emit("app.appearance", ["dark": dark]) }
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    var isDark: Bool {
        NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }

    // Finder 双击、拖到 Dock 图标:有空白窗口就用它,否则开新窗口
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            var isDir: ObjCBool = false
            FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
            open(path: url.path, isDir: isDir.boolValue, newWindow: false)
        }
    }

    /// 偏好「所有窗口被关闭后自动退出」(PG-01,默认关);冒烟自检由自检流程自己退出
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        guard smokeOut == nil else { return false }
        do {
            return (try settings.load()["quitOnLastWindowClosed"] as? Bool) ?? false
        } catch {
            NSLog("Typoza:读取偏好设置失败,关闭最后一个窗口后不退出:%@", "\(error)")
            return false
        }
    }

    /// 不自动退出时可能一个窗口都没有:点程序坞图标开一个新窗口
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag && windows.isEmpty { newWindow(open: nil) }
        return true
    }

    // ---------- 窗口 ----------

    @discardableResult
    func newWindow(open: (String, Bool)?, asTabOf parent: NSWindow? = nil) -> DocumentWindowController {
        let controller = DocumentWindowController(app: self, open: open, smokeOut: windows.isEmpty ? smokeOut : nil)
        windows.append(controller)
        if let parent, let window = controller.window {
            parent.addTabbedWindow(window, ordered: .above)
        }
        controller.showWindow(nil)
        if let path = open?.0 { noteRecent(path) }
        return controller
    }

    func windowClosed(_ controller: DocumentWindowController) {
        if let path = controller.currentPath { closedPaths.append(path) }
        windows.removeAll { $0 === controller }
    }

    /// 打开文件:已在某个窗口里打开就切过去;当前窗口是空白新文档就直接用它;否则开新窗口。
    func open(path: String, isDir: Bool, newWindow forceNew: Bool) {
        if !isDir, let existing = windows.first(where: { $0.currentPath == path }) {
            existing.window?.makeKeyAndOrderFront(nil)
            return
        }
        if !forceNew, let key = keyController, key.isBlank {
            key.load(path: path, isDir: isDir)
            if !isDir { noteRecent(path) }
            return
        }
        newWindow(open: (path, isDir), asTabOf: nil)
    }

    var keyController: DocumentWindowController? {
        windows.first { $0.window === NSApp.keyWindow } ?? windows.last
    }

    func noteRecent(_ path: String) {
        NSDocumentController.shared.noteNewRecentDocumentURL(URL(fileURLWithPath: path))
    }

    // ---------- 菜单 ----------

    @objc func menuCommand(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        switch id {
        case "native.newWindow":
            newWindow(open: nil)
        case "native.newTab":
            newWindow(open: nil, asTabOf: NSApp.keyWindow)
        case "native.open":
            showOpenPanel()
        case "native.reopenClosed":
            if let path = closedPaths.popLast() { open(path: path, isDir: false, newWindow: true) }
        case "native.saveAll":
            windows.forEach { $0.sendCommand("file.save") }
        case "native.alwaysOnTop":
            if let window = NSApp.keyWindow {
                window.level = window.level == .floating ? .normal : .floating
                sender.state = window.level == .floating ? .on : .off
            }
        case "native.import":
            showImportPanel()
        case "native.welcome":
            openWelcome()
        default:
            if let key = keyController {
                key.sendCommand(id)
            } else {
                newWindow(open: nil).sendCommandWhenReady(id)
            }
        }
    }

    private func showOpenPanel() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.message = "选择 Markdown 文件或文件夹"
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            var isDir: ObjCBool = false
            FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
            open(path: url.path, isDir: isDir.boolValue, newWindow: false)
        }
    }

    /// 导入(Typora):用 Pandoc 把 Word / HTML / EPUB 等转成 Markdown,存在原文件旁边后打开。
    private func showImportPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.message = "选择要导入的文件(需要已安装 Pandoc)"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let pandoc = try ExportService.locatePandoc(configured: (try? settings.load())?["pandocPath"] as? String)
            var target = url.deletingPathExtension().appendingPathExtension("md")
            var i = 1
            while FileManager.default.fileExists(atPath: target.path) {
                target = url.deletingPathExtension().deletingLastPathComponent().appendingPathComponent("\(url.deletingPathExtension().lastPathComponent)-\(i).md")
                i += 1
            }
            try ExportService.runPandoc(pandoc, arguments: [url.path, "-t", "gfm", "--wrap=none", "--extract-media=\(url.deletingLastPathComponent().appendingPathComponent("assets").path)", "-o", target.path], input: nil, workingDirectory: url.deletingLastPathComponent())
            open(path: target.path, isDir: false, newWindow: true)
        } catch {
            NSAlert(error: error).runModal()
        }
    }

    private func openWelcome() {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("editor/welcome.md"), FileManager.default.fileExists(atPath: url.path) else { return }
        let dir = AppPaths.support.appendingPathComponent("welcome", isDirectory: true)
        let target = dir.appendingPathComponent("快速上手.md")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: target.path) { try FileManager.default.copyItem(at: url, to: target) }
            open(path: target.path, isDir: false, newWindow: true)
        } catch {
            NSAlert(error: error).runModal()
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === recentMenu else { return }
        menu.removeAllItems()
        for url in NSDocumentController.shared.recentDocumentURLs {
            let item = NSMenuItem(title: url.lastPathComponent, action: #selector(openRecent(_:)), keyEquivalent: "")
            item.representedObject = url.path
            item.toolTip = url.path
            item.target = self
            menu.addItem(item)
        }
        if menu.items.isEmpty {
            menu.addItem(NSMenuItem(title: "无", action: nil, keyEquivalent: ""))
        }
        menu.addItem(.separator())
        let clear = NSMenuItem(title: "清除菜单", action: #selector(clearRecent(_:)), keyEquivalent: "")
        clear.target = self
        menu.addItem(clear)
    }

    @objc private func openRecent(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        open(path: path, isDir: false, newWindow: false)
    }

    @objc private func clearRecent(_ sender: NSMenuItem) {
        NSDocumentController.shared.clearRecentDocuments(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        helper.stop()
    }

    // ---------- 退出:逐个窗口确认未保存的修改 ----------

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let edited = windows.filter { $0.window?.isDocumentEdited == true }
        if edited.isEmpty || smokeOut != nil { return .terminateNow }
        confirmSequentially(edited) { ok in
            NSApp.reply(toApplicationShouldTerminate: ok)
        }
        return .terminateLater
    }

    private func confirmSequentially(_ list: [DocumentWindowController], completion: @escaping (Bool) -> Void) {
        guard let first = list.first else {
            completion(true)
            return
        }
        first.window?.makeKeyAndOrderFront(nil)
        first.prepareClose { ok in
            if !ok {
                completion(false)
                return
            }
            self.confirmSequentially(Array(list.dropFirst()), completion: completion)
        }
    }
}
