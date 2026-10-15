import Foundation

/// HTTP Range 请求头解析结果。`<video>` / `<audio>` 播放本地文件时 WebKit 会发 Range 请求,
/// 自定义协议处理器必须按 206 分段响应,否则媒体无法拖动进度条或直接加载失败。
public enum ByteRangeResult: Equatable {
    case full
    case partial(start: Int64, end: Int64) // 闭区间
    case unsatisfiable
}

public enum ByteRange {
    /// - Parameters:
    ///   - header: Range 请求头原文,如 `bytes=0-`、`bytes=100-199`、`bytes=-500`
    ///   - size: 文件总字节数
    ///   - maxChunk: 单次响应最多返回的字节数;`bytes=0-` 这类开放区间只回一段,播放器会继续请求后续区间
    public static func parse(_ header: String?, size: Int64, maxChunk: Int64) -> ByteRangeResult {
        guard let header, header.hasPrefix("bytes=") else { return .full }
        // 只支持单区间;多区间请求取第一个
        let spec = header.dropFirst("bytes=".count).split(separator: ",").first.map(String.init) ?? ""
        let parts = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map {
            $0.trimmingCharacters(in: .whitespaces)
        }
        guard parts.count == 2, size > 0 else { return size == 0 ? .unsatisfiable : .full }

        var start: Int64
        var end: Int64
        if parts[0].isEmpty {
            guard let suffix = Int64(parts[1]), suffix > 0 else { return .unsatisfiable }
            start = max(0, size - suffix)
            end = size - 1
        } else {
            guard let s = Int64(parts[0]), s >= 0 else { return .full }
            guard s < size else { return .unsatisfiable }
            start = s
            if parts[1].isEmpty {
                end = size - 1
            } else {
                guard let e = Int64(parts[1]), e >= s else { return .unsatisfiable }
                end = min(e, size - 1)
            }
        }
        if end - start + 1 > maxChunk { end = start + maxChunk - 1 }
        return .partial(start: start, end: end)
    }
}
