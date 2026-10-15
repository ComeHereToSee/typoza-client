import CoreServices
import Foundation

/// 用 FSEvents 监听若干路径(文件或文件夹),变化以去重后的路径列表回调到主线程。
/// 用路径级监听而不是 inode 级:原子保存会替换文件,inode 监听在替换后就失效了。
public final class FileWatcher {
    private var stream: FSEventStreamRef?
    private var paths: Set<String> = []
    private let callback: ([String]) -> Void

    public init(callback: @escaping ([String]) -> Void) {
        self.callback = callback
    }

    deinit {
        stop()
    }

    public func watch(_ newPaths: [String]) {
        let merged = paths.union(newPaths)
        guard merged != paths else { return }
        paths = merged
        restart()
    }

    private func stop() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    private func restart() {
        stop()
        // 监听文件所在的文件夹:文件本身被原子替换时也能收到事件
        let roots = Array(Set(paths.map { path -> String in
            var isDir: ObjCBool = false
            return FileManager.default.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue ? path : (path as NSString).deletingLastPathComponent
        }))
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let flags = UInt32(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer)
        guard let stream = FSEventStreamCreate(
            kCFAllocatorDefault,
            { _, info, count, eventPaths, _, _ in
                guard let info else { return }
                let watcher = Unmanaged<FileWatcher>.fromOpaque(info).takeUnretainedValue()
                let array = Unmanaged<CFArray>.fromOpaque(eventPaths).takeUnretainedValue() as? [String] ?? []
                watcher.callback(Array(Set(array.prefix(count))))
            },
            &context,
            roots as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.3,
            flags
        ) else { return }
        FSEventStreamSetDispatchQueue(stream, DispatchQueue.main)
        FSEventStreamStart(stream)
        self.stream = stream
    }
}
