import Foundation

/// Non-secret cold-launch checkpoint. A forced termination during a
/// transition may also trigger recovery; this is not a crash handler.
enum XDriveIOSNativeLaunchCheckpoint {
    enum Phase: String {
        case initializing
        case retiringCredential
        case restoringSession
        case mountingWorkspace
        case recovery
        case ready
    }

    /// Fixed vocabulary. Never record URL, Owner ID, PhotoKit ID, filename,
    /// credentials, HTTP body or raw exception descriptions.
    enum PostLoginStep: String {
        case manualOwnerVerified
        case restoredOwnerVerified
        case refreshingOwnerBackup
        case diagnosticWorkspaceVisible
        case dashboardAppeared
        case openingDashboard
    }

    struct Interruption {
        let phase: Phase
        let lastStep: PostLoginStep?
        let lastStepAt: Date?

        /// A system-level fatal exception still needs the iOS .ips report.
        func summary(build: String) -> String {
            let date = lastStepAt.map {
                ISO8601DateFormatter().string(from: $0)
            } ?? "not-recorded"
            return """
            xDrive iOS interrupted transition
            build: \(build)
            previous-phase: \(phase.rawValue)
            last-post-login-step: \(lastStep?.rawValue ?? "not-recorded")
            last-step-utc: \(date)
            fatal-exception: see iOS Analytics .ips (not captured in-process)
            """
        }
    }

    private static let key = "xdrive.ios.native.launch-checkpoint.v1"
    private static let stepKey = "xdrive.ios.native.last-post-login-step.v1"
    private static let dateKey = "xdrive.ios.native.last-post-login-date.v1"

    /// Capture the previous process before marking the current launch.
    /// Never erase an Owner credential, PhotoKit grant or backup journal.
    @discardableResult
    static func beginReport(defaults: UserDefaults = .standard) -> Interruption? {
        let previous = Phase(rawValue: defaults.string(forKey: key) ?? "")
        let report: Interruption?
        if let previous, previous != .ready {
            report = Interruption(
                phase: previous,
                lastStep: PostLoginStep(rawValue: defaults.string(forKey: stepKey) ?? ""),
                lastStepAt: defaults.object(forKey: dateKey) as? Date
            )
        } else {
            report = nil
        }
        mark(.initializing, defaults: defaults)
        return report
    }

    /// Compatibility with callers expecting only the prior phase.
    @discardableResult
    static func begin(defaults: UserDefaults = .standard) -> Phase? {
        beginReport(defaults: defaults)?.phase
    }

    /// Set BEFORE publishing the verified Owner or constructing its Dashboard.
    /// A crash during that transition leaves non-secret stage evidence.
    static func markPostLogin(
        _ step: PostLoginStep, defaults: UserDefaults = .standard,
        now: Date = Date()
    ) {
        defaults.set(Phase.mountingWorkspace.rawValue, forKey: key)
        defaults.set(step.rawValue, forKey: stepKey)
        defaults.set(now, forKey: dateKey)
    }

    static func mark(_ phase: Phase, defaults: UserDefaults = .standard) {
        defaults.set(phase.rawValue, forKey: key)
        if phase == .ready {
            defaults.removeObject(forKey: stepKey)
            defaults.removeObject(forKey: dateKey)
        }
    }

    /// A cancelled login/restore view task is not evidence that an already
    /// mounted workspace failed. Only the visible scene acknowledges readiness.
    static func mayFinishStartup(
        restoreComplete: Bool, workspaceVisible: Bool, foreground: Bool
    ) -> Bool {
        restoreComplete && workspaceVisible && foreground
    }

    /// Original writing cannot start during an unready handoff or safe boot.
    static func mayAutoBackup(
        startupReady: Bool, safeStartup: Bool, foreground: Bool
    ) -> Bool {
        startupReady && !safeStartup && foreground
    }
}
