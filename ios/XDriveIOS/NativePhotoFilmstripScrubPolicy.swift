import Foundation

/// A foreground gesture may select only a neighbor within the already verified
/// bounded filmstrip page. This policy never loads, persists, or scans media.
enum XDriveIOSNativePhotoFilmstripScrubPolicy {
    static let maximumPageCount = 64
    static let tileStride: CGFloat = 46
    static let minimumHorizontal: CGFloat = 18

    /// Left drag advances in photo order; right drag moves backward.
    /// Reject vertical gestures, non-finite input and invalid/revoked pages.
    static func targetIndex(
        startingAt start: Int,
        loadedCount count: Int,
        horizontal dx: CGFloat,
        vertical dy: CGFloat,
        authorized: Bool
    ) -> Int? {
        guard authorized, count >= 2, count <= maximumPageCount,
              start >= 0, start < count,
              dx.isFinite, dy.isFinite,
              abs(dx) >= minimumHorizontal,
              abs(dx) > abs(dy) * 1.5
        else { return nil }

        // Clamp before Int conversion. In particular, an enormous but finite
        // drag cannot overflow when changed/ended gestures are replayed.
        let moves = min(CGFloat(count - 1),
                        floor((abs(dx) - minimumHorizontal) / tileStride) + 1)
        let delta = Int(moves) * (dx < 0 ? 1 : -1)
        return max(0, min(count - 1, start + delta))
    }
}
