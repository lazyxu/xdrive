import Foundation

/// Deliberately small immutable policy; a BG task must not infer user
/// approval from a mutable Web/localStorage flag or a Device identity alone.
enum XDriveIOSBGApprovalPolicy {
    static let supportedIntervals = [60, 360, 1440]
    static let maximumGrantLifetime: TimeInterval = 15 * 24 * 60 * 60

    static func validInterval(_ minutes: Int) -> Bool {
        supportedIntervals.contains(minutes)
    }

    static func validLifetime(approvedAt: Date, expiresAt: Date,
                              now: Date) -> Bool {
        expiresAt > now &&
        approvedAt <= now.addingTimeInterval(120) &&
        expiresAt > approvedAt &&
        expiresAt <= approvedAt.addingTimeInterval(maximumGrantLifetime)
    }
}
