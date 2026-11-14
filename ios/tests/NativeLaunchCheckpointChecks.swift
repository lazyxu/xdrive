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

        // Repro: a sign-out form marked ready, then a successful manual
        // sign-in crashes while constructing the authenticated Dashboard.
        let timestamp = Date(timeIntervalSince1970: 1_700_000_000)
        checkpoint.mark(.ready, defaults: prefs)
        checkpoint.markPostLogin(.manualOwnerVerified, defaults: prefs, now: timestamp)
        let interrupted = checkpoint.beginReport(defaults: prefs)
        precondition(interrupted?.phase == .mountingWorkspace)
        precondition(interrupted?.lastStep == .manualOwnerVerified)
        precondition(interrupted?.lastStepAt == timestamp)
        let diagnostic = interrupted?.summary(build: "test-build") ?? ""
        precondition(diagnostic.contains("manualOwnerVerified"))
        precondition(diagnostic.contains("test-build"))
        precondition(!diagnostic.contains("password="))

        // After recovery displays the first interruption, its in-memory
        // report remains intact but persistent step keys must be cleared.
        // A *second* interrupted login must report the second, not the first.
        checkpoint.mark(.recovery, defaults: prefs)
        let nextTimestamp = timestamp.addingTimeInterval(35)
        checkpoint.markPostLogin(.openingDashboard, defaults: prefs, now: nextTimestamp)
        let second = checkpoint.beginReport(defaults: prefs)
        precondition(second?.phase == .mountingWorkspace)
        precondition(second?.lastStep == .openingDashboard)
        precondition(second?.lastStepAt == nextTimestamp)
        precondition(interrupted?.lastStep == .manualOwnerVerified)

        // A forced exit from the recovery UI without a new login must not
        // accidentally replay old post-login breadcrumbs on its next boot.
        let noNewLogin = checkpoint.beginReport(defaults: prefs)
        precondition(noNewLogin?.phase == .initializing)
        precondition(noNewLogin?.lastStep == nil)
        precondition(noNewLogin?.lastStepAt == nil)
        checkpoint.mark(.ready, defaults: prefs)
        precondition(checkpoint.beginReport(defaults: prefs) == nil)

        // A stable diagnostic-only workspace is NOT a persistent crash loop.
        checkpoint.markPostLogin(.diagnosticWorkspaceVisible, defaults: prefs)
        checkpoint.mark(.ready, defaults: prefs)
        precondition(checkpoint.beginReport(defaults: prefs) == nil)
        print("native cold-launch and post-login crash diagnostics: passed")
    }
}
