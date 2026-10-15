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
}
