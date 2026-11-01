import SwiftUI

@main
struct XDriveIOSApp: App {
    private let interruptedStage: XDriveIOSNativeLaunchCheckpoint.Phase?

    init() {
        // Record startup before any legacy Keychain or BGTask setup. If the
        // previous process died during startup, the next launch must offer
        // an isolated UI instead of repeating the same automatic work.
        interruptedStage = XDriveIOSNativeLaunchCheckpoint.begin()
        // BG task handlers still need registration before launch completes.
        XDriveIOSBackgroundPhotoTask.registerAtLaunch()
    }

    var body: some Scene {
        WindowGroup {
            XDriveIOSNativeStartupRoot(interruptedStage: interruptedStage)
        }
    }
}

/// The rescue page has no session model, PhotoKit reader or backup controller.
/// It must still render if construction of the signed-in workspace crashes.
private struct XDriveIOSNativeStartupRoot: View {
    let interruptedStage: XDriveIOSNativeLaunchCheckpoint.Phase?
    @State private var normalStartup: Bool

    init(interruptedStage: XDriveIOSNativeLaunchCheckpoint.Phase?) {
        self.interruptedStage = interruptedStage
        _normalStartup = State(initialValue: interruptedStage == nil)
    }

    var body: some View {
        Group {
            if normalStartup {
                XDriveIOSNativeOwnerLoginScreen()
            } else {
                NavigationStack {
                    VStack(alignment: .leading, spacing: 18) {
                        Label("上一次启动未完成", systemImage: "exclamationmark.triangle")
                            .font(.title3.weight(.semibold))
                        Text("xDrive 已暂缓自动登录与前台备份，以避免重复触发启动阶段的问题。不会删除登录资料、照片或备份收据。")
                            .foregroundStyle(.secondary)
                        Text("上一次阶段：\(interruptedStage?.rawValue ?? "unknown")")
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                            .accessibilityIdentifier("native-ios-startup-phase")
                        Button("尝试重新启动原生客户端") {
                            XDriveIOSNativeLaunchCheckpoint.mark(.initializing)
                            normalStartup = true
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("native-ios-startup-retry")
                        Text("若再次退出，请提供 iPhone 分析数据中 xDrive 的 .ips 崩溃报告。编译通过不代表已在真机完成启动验证。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(24)
                    .frame(maxWidth: 480, maxHeight: .infinity, alignment: .topLeading)
                    .navigationTitle("启动恢复")
                }
                .accessibilityIdentifier("native-ios-startup-recovery")
                .onAppear {
                    XDriveIOSNativeLaunchCheckpoint.mark(.recovery)
                }
            }
        }
    }
}
