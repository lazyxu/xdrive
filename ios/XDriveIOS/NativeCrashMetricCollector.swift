import Foundation
import MetricKit

/// Best-effort *system-delivered* crash metadata. Never install unsafe signal
/// or uncaught-exception UI handlers: a fatally corrupted process must exit.
/// MetricKit may deliver diagnostics later, not necessarily at next launch.
final class XDriveIOSNativeCrashMetricCollector: NSObject, MXMetricManagerSubscriber {
    static let shared = XDriveIOSNativeCrashMetricCollector()
    static let notification = Notification.Name("xdrive.ios.native.crash-metric-delivered")
    private static let key = "xdrive.ios.native.latest-crash-metric.v1"

    private var registered = false

    static var latestSummary: String? {
        UserDefaults.standard.string(forKey: key)
    }

    func start() {
        guard !registered else { return }
        registered = true
        MXMetricManager.shared.add(self)
    }

    // The SDK calls this at most when an OS report becomes available. No raw
    // stack frames, arbitrary exception strings, Owner details or URLs are
    // persisted. Exact symbolication still requires the user's .ips + dSYM.
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            guard let crash = payload.crashDiagnostics?.last else { continue }
            let summary = [
                "MetricKit system crash report (may be from an earlier launch)",
                "report-window-end-utc: " +
                    ISO8601DateFormatter().string(from: payload.timeStampEnd),
                "mach-exception-type: " + (crash.exceptionType?.stringValue ?? "unknown"),
                "exception-code: " + (crash.exceptionCode?.stringValue ?? "unknown"),
                "posix-signal: " + (crash.signal?.stringValue ?? "unknown"),
                "symbolicated-stack: requires original iOS .ips and dSYM"
            ].joined(separator: "\n")
            UserDefaults.standard.set(summary, forKey: Self.key)
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: Self.notification, object: nil)
            }
        }
    }
}
