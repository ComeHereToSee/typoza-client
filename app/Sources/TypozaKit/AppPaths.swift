import Foundation

/// 应用数据目录:~/Library/Application Support/Typoza/
public enum AppPaths {
    public static var support: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("Typoza", isDirectory: true)
    }

    public static var settingsFile: URL { support.appendingPathComponent("settings.json") }
    public static var historyDir: URL { support.appendingPathComponent("history", isDirectory: true) }
    /// 同步辅助进程的配置与各库状态(不含密钥,密钥在钥匙串)
    public static var syncDir: URL { support.appendingPathComponent("sync", isDirectory: true) }
    /// ~/Library/Logs/Typoza/
    public static var logsDir: URL {
        let base = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library")
        return base.appendingPathComponent("Logs/Typoza", isDirectory: true)
    }
}
