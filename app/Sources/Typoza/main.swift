import AppKit

// 进程起点的时间戳,用于冒烟测试统计「启动 → 编辑器就绪」耗时。
let launchUptime = ProcessInfo.processInfo.systemUptime

// 同步辅助进程意外退出时,向它的管道写入不能让整个应用被 SIGPIPE 杀掉;写失败按错误处理
signal(SIGPIPE, SIG_IGN)

let app = NSApplication.shared
let delegate = AppDelegate(launchUptime: launchUptime)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
