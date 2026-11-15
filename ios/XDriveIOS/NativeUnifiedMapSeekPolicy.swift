import Foundation

/// A unified-source map is published only after a complete, verified cursor
/// traversal. A place wall must search that same bounded source: a gap of 256
/// pages without matching GPS media is not proof that the place has ended.
enum XDriveIOSNativeUnifiedMapSeekPolicy {
    static let maximumPages = 10_000
    static let cooperativeYieldPages = 256

    /// Called before processing this zero-based page. A cooperative yield is
    /// not a terminal condition, and never admits another Owner or epoch.
    static func shouldYield(beforePage page: Int) -> Bool {
        page > 0 && page < maximumPages && page % cooperativeYieldPages == 0
    }
}
