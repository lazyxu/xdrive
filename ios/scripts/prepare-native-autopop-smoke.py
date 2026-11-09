#!/usr/bin/env python3
"""Instrument a real Files child in a disposable iOS Simulator source tree.

The published b9 and candidate product sources are immutable. This fixture
uses an independent MainActor Task, not a SwiftUI .task bound to transient
view identity, to distinguish a genuinely unsuccessful dismiss() from a
canceled timer. It records only fixed stage labels in the test app's tmp.
"""
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
browser = root / "ios/XDriveIOS/NativeCloudFilesBrowser.swift"
s = browser.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global s
    if s.count(old) != 1:
        raise SystemExit("Native AutoPop fixture anchor changed: "
                         + repr(old[:90]) + " count=" + str(s.count(old)))
    s = s.replace(old, new, 1)


replace_once(
    "import SwiftUI\n",
    """import SwiftUI

// CI-only actor-isolated once gate. Never shipped in the real IPA.
@MainActor private enum XDriveCINativePopOnce {
    static var scheduled = false
}
""",
)
replace_once(
    "    @Environment(\\.scenePhase) private var phase",
    r'''    @Environment(\.scenePhase) private var phase
    @Environment(\.dismiss) private var xdriveTestAutoDismiss

    private func xdriveCITrace(_ stage: String) {
        guard ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop") else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("native-autopop-trace.txt")
        let previous = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        try? (previous + stage + "\n").write(to: url, atomically: true, encoding: .utf8)
    }''',
)
replace_once(
    '    @ViewBuilder private var filesHome: some View {\n        Section("位置") {',
    '''    @ViewBuilder private var filesHome: some View {
        Section("位置") {
            if ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop") {
                Text("CI-only native Home restored")
                    .accessibilityIdentifier("native-ios-ci-native-autopop-home")
            }''',
)
replace_once(
    "            filesModals\n        .onAppear {",
    r'''            filesModals
        .onAppear {
            guard ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop") else { return }
            xdriveCITrace("appeared:isHome=\(isHome)")
            guard !isHome, let expected = login.owner,
                  folder?.id == expected.rootNodeID else { return }
            // Deliberately unstructured: a temporary SwiftUI view may
            // disappear/reappear during navigation; .task would cancel
            // its timer and create a false negative before dismiss().
            Task { @MainActor in
                guard !XDriveCINativePopOnce.scheduled else { return }
                XDriveCINativePopOnce.scheduled = true
                xdriveCITrace("scheduled")
                do {
                    try await Task.sleep(nanoseconds: 1_500_000_000)
                } catch {
                    xdriveCITrace("unexpected-cancellation")
                    return
                }
                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
                    xdriveCITrace("owner-revoked")
                    return
                }
                xdriveCITrace("before-dismiss")
                xdriveTestAutoDismiss()
                xdriveCITrace("after-dismiss")
            }
        }
        .onAppear {''',
)
browser.write_text(s, encoding="utf-8")
print("CI-only independent native pop fixture installed:", browser)
