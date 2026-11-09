import Foundation

/// A persisted positional PhotoKit cursor is trustworthy only for the exact
/// same library generation and read-authorization scope. Actual PhotoKit
/// tokens are securely decoded/compared by the native schedule store.
enum XDrivePhotoCursorEpochPolicy {
    static func canResume(
        hasPriorToken: Bool, tokenUnchanged: Bool,
        previousAuthorization: Int?, currentAuthorization: Int
    ) -> Bool {
        hasPriorToken && tokenUnchanged &&
            previousAuthorization == currentAuthorization
    }

    /// PhotoKit change-queue counts are only current if their durable replay
    /// baseline matches the exact authorized library generation. An old local
    /// confirmed row is not evidence of a current cloud receipt.
    static func canShowChangeQueueSnapshot(
        hasBaseline: Bool, tokenUnchanged: Bool,
        previousAuthorization: Int?, currentAuthorization: Int
    ) -> Bool {
        canResume(hasPriorToken: hasBaseline, tokenUnchanged: tokenUnchanged,
                  previousAuthorization: previousAuthorization,
                  currentAuthorization: currentAuthorization)
    }

    static func trustedWindow(
        requested: Int, hasPriorToken: Bool,
        tokenUnchanged: Bool, previousAuthorization: Int?,
        currentAuthorization: Int
    ) -> Int {
        guard requested >= 0,
              canResume(hasPriorToken: hasPriorToken,
                        tokenUnchanged: tokenUnchanged,
                        previousAuthorization: previousAuthorization,
                        currentAuthorization: currentAuthorization) else {
            return 0
        }
        return requested
    }
}
