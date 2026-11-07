import Foundation

/// Non-secret, process-local cold-launch checkpoint. This is diagnostics and
/// opt-in recovery, not a crash handler, credential store or health guarantee.
/// A force-quit while startup is incomplete may also trigger recovery.
enum XDriveIOSNativeLaunchCheckpoint {
    enum Phase: String {
        case initializing
        case retiringCredential
        case restoringSession
        case mountingWorkspace
        case recovery
        case ready
    }

    private static let key = "xdrive.ios.native.launch-checkpoint.v1"

    /// A previously incomplete startup opens the independent recovery page.
    /// Never erase an Owner credential, PhotoKit grant or backup journal.
    @discardableResult
    static func begin(defaults: UserDefaults = .standard) -> Phase? {
        let prior = Phase(rawValue: defaults.string(forKey: key) ?? "")
        mark(.initializing, defaults: defaults)
        return prior == .ready ? nil : prior
    }

    static func mark(_ phase: Phase, defaults: UserDefaults = .standard) {
        defaults.set(phase.rawValue, forKey: key)
    }

    /// A cancelled login/restore view task is not evidence that an already
    /// mounted native workspace failed. Only the visible scene may acknowledge
    /// readiness, independently of the task that restored the session.
    static func mayFinishStartup(
        restoreComplete: Bool, workspaceVisible: Bool, foreground: Bool
    ) -> Bool {
        restoreComplete && workspaceVisible && foreground
    }

    /// Do not start an automatic foreground original writer until native UI
    /// startup has completed. A user-selected rescue boot stays read-only
    /// unless the user explicitly starts an operation.
    static func mayAutoBackup(
        startupReady: Bool, safeStartup: Bool, foreground: Bool
    ) -> Bool {
        startupReady && !safeStartup && foreground
    }
}
