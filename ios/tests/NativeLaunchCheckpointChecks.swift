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
        checkpoint.mark(.ready, defaults: prefs)
        precondition(checkpoint.begin(defaults: prefs) == nil)
        print("native cold-launch checkpoint recovery: passed")
    }
}
