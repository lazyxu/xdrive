import Foundation

@main
struct NativeLaunchCheckpointChecks {
    static func main() {
        let suite = "xdrive-ios-startup-check-\(UUID().uuidString)"
        guard let prefs = UserDefaults(suiteName: suite) else {
            fatalError("test UserDefaults unavailable")
        }
        defer { prefs.removePersistentDomain(forName: suite) }
        let checkpoint = XDriveIOSNativeLaunchCheckpoint.self
        precondition(checkpoint.begin(defaults: prefs) == nil)
        precondition(checkpoint.begin(defaults: prefs) == .initializing)
        checkpoint.mark(.restoringSession, defaults: prefs)
        precondition(checkpoint.begin(defaults: prefs) == .restoringSession)
        checkpoint.mark(.recovery, defaults: prefs)
        precondition(checkpoint.begin(defaults: prefs) == .recovery)
        // Reproduction: a cancelled view-attached sleep leaves a mounted
        // workspace recorded as unfinished on the next cold start.
        checkpoint.mark(.mountingWorkspace, defaults: prefs)
        precondition(checkpoint.begin(defaults: prefs) == .mountingWorkspace)
        precondition(!checkpoint.mayFinishStartup(
            restoreComplete: false, workspaceVisible: true, foreground: true
        ))
        precondition(!checkpoint.mayFinishStartup(
            restoreComplete: true, workspaceVisible: false, foreground: true
        ))
        precondition(!checkpoint.mayFinishStartup(
            restoreComplete: true, workspaceVisible: true, foreground: false
        ))
        precondition(checkpoint.mayFinishStartup(
            restoreComplete: true, workspaceVisible: true, foreground: true
        ))
        precondition(!checkpoint.mayAutoBackup(
            startupReady: false, safeStartup: false, foreground: true
        ))
        precondition(!checkpoint.mayAutoBackup(
            startupReady: true, safeStartup: true, foreground: true
        ))
        precondition(!checkpoint.mayAutoBackup(
            startupReady: true, safeStartup: false, foreground: false
        ))
        precondition(checkpoint.mayAutoBackup(
            startupReady: true, safeStartup: false, foreground: true
        ))
        checkpoint.mark(.ready, defaults: prefs)
        precondition(checkpoint.begin(defaults: prefs) == nil)
        print("native cold-launch checkpoint recovery and safe boot policy: passed")
    }
}
