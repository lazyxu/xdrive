#!/usr/bin/env python3
"""CI-only native SwiftUI dismiss() experiment for a synthetic offline Owner.

Run after prepare-navigation-runtime-smoke.py inside a disposable source tree.
It deliberately does NOT edit the persistent repository or production IPA.
No real authentication or fake network reply is installed.
"""
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
browser = root / "ios/XDriveIOS/NativeCloudFilesBrowser.swift"
s = browser.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global s
    if s.count(old) != 1:
        raise SystemExit(
            "Autopop fixture anchor changed: "
            + repr(old[:90])
            + " matches=" + str(s.count(old))
        )
    s = s.replace(old, new, 1)


replace_once(
    "    @Environment(\\.scenePhase) private var phase",
    "    @Environment(\\.scenePhase) private var phase\n"
    "    // CI-only route to separate SwiftUI pop from XCTest app coordinate lookup.\n"
    "    @Environment(\\.dismiss) private var xdriveTestAutoDismiss",
)
replace_once(
    '    @ViewBuilder private var filesHome: some View {\n        Section("位置") {',
    '    @ViewBuilder private var filesHome: some View {\n        Section("位置") {\n'
    '            if ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop") {\n'
    '                Text("CI-only native Home restored")\n'
    '                    .accessibilityIdentifier("native-ios-ci-native-autopop-home")\n'
    '            }',
)
replace_once(
    "            filesModals\n        .onAppear {",
    """            filesModals
        .task {
            guard ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop"),
                  !isHome, let expected = login.owner,
                  folder?.id == expected.rootNodeID else { return }
            print("NATIVE_AUTOPOP_STAGE mounted-child")
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
            else { return }
            // Call the native SwiftUI DismissAction on the owning MainActor.
            // Never use an XCTest coordinate / AX event to trigger this pop.
            print("NATIVE_AUTOPOP_STAGE before-dismiss")
            xdriveTestAutoDismiss()
            print("NATIVE_AUTOPOP_STAGE after-dismiss")
        }
        .onAppear {""",
)

# CI-only app-container breadcrumbs, independent of XCTest AX queries.
# Never include Owner IDs, file names, credentials or real media paths.
replace_once(
    r'    @Environment(\.dismiss) private var xdriveTestAutoDismiss',
    r'''    @Environment(\.dismiss) private var xdriveTestAutoDismiss

    private func xdriveCITrace(_ stage: String) {
        guard ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop") else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("native-autopop-trace.txt")
        let previous = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        try? (previous + stage + "\n").write(to: url, atomically: true, encoding: .utf8)
    }'''
)
replace_once(
    '        .task {\n            guard ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop"),',
    '        .task {\n            if ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop") {\n'
    '                xdriveCITrace("task-enter:isHome=\\(isHome)")\n'
    '            }\n'
    '            guard ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop"),'
)
replace_once(
    '            print("NATIVE_AUTOPOP_STAGE mounted-child")',
    '            xdriveCITrace("guard-passed:mounted-child")'
)
replace_once(
    '            print("NATIVE_AUTOPOP_STAGE before-dismiss")',
    '            xdriveCITrace("before-dismiss")'
)
replace_once(
    '            print("NATIVE_AUTOPOP_STAGE after-dismiss")',
    '            xdriveCITrace("after-dismiss")'
)
replace_once(
    '        .onAppear {\n            // Returning from a child must keep the same verified rows',
    '        .onDisappear {\n'
    '            if ProcessInfo.processInfo.arguments.contains("-xdrive-ci-native-autopop") {\n'
    '                xdriveCITrace("browser-disappeared")\n'
    '            }\n'
    '        }\n'
    '        .onAppear {\n'
    '            // Returning from a child must keep the same verified rows'
)

browser.write_text(s, encoding="utf-8")
print("CI-only native pop fixture installed:", browser)
