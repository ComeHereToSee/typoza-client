import AppKit

// 进程起点的时间戳,用于冒烟测试统计「启动 → 编辑器就绪」耗时。
let launchUptime = ProcessInfo.processInfo.systemUptime

let app = NSApplication.shared
let delegate = AppDelegate(launchUptime: launchUptime)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
