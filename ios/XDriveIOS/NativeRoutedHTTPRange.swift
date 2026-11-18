import Foundation

/// Exact, bounded HTTP Range response proof for AVFoundation playback.
/// No guessed EOF, compressed-body ranges, or partial signed-ticket success.
struct XDriveIOSRoutedHTTPRange: Equatable {
    let first: Int64
    let last: Int64
    let total: Int64

    static func parse(_ header: String?) -> Self? {
        guard let header, header.hasPrefix("bytes ") else { return nil }
        let parts = header.dropFirst(6).split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let total = Int64(String(parts[1])), total > 0 else { return nil }
        let bounds = parts[0].split(separator: "-", omittingEmptySubsequences: false)
        guard bounds.count == 2,
              let first = Int64(String(bounds[0])),
              let last = Int64(String(bounds[1])),
              first >= 0, last >= first, last < total else { return nil }
        return Self(first: first, last: last, total: total)
    }

    static func bounded(_ header: String?, first: Int64, maximumEnd: Int64,
                        maximumBytes: Int64 = 256 * 1_024) -> Self? {
        guard let candidate = parse(header),
              first >= 0, maximumEnd >= first,
              candidate.first == first, candidate.last <= maximumEnd,
              candidate.last - candidate.first < maximumBytes else { return nil }
        return candidate
    }
}
