import Combine
import SwiftUI
import UIKit

@main
struct XDriveIOSApp: App {
    @UIApplicationDelegateAdaptor(XDriveIOSPhotoBackupRemoteHintDelegate.self)
    private var photoWakeDelegate

    private let interruption: XDriveIOSNativeLaunchCheckpoint.Interruption?

    init() {
        // Read the previous process checkpoint BEFORE starting this one.
        interruption = XDriveIOSNativeLaunchCheckpoint.beginReport()
        XDriveIOSNativeCrashMetricCollector.shared.start()
        XDriveIOSBackgroundPhotoTask.registerAtLaunch()
    }

    var body: some Scene {
        WindowGroup {
            XDriveIOSNativeStartupRoot(interruption: interruption)
        }
    }
}

/// Independent rescue page: no login model, PhotoKit reader or backup runner.
private struct XDriveIOSNativeStartupRoot: View {
    let interruption: XDriveIOSNativeLaunchCheckpoint.Interruption?
    @State private var normalStartup: Bool
    @State private var safeStartup = false
    @State private var diagnosticWorkspace = false
    @State private var metricDiagnostic = XDriveIOSNativeCrashMetricCollector.latestSummary

    private var diagnosticSummary: String {
        [interruption?.summary(build: XDriveIOSNativeBuildIdentity.label), metricDiagnostic]
            .compactMap { $0 }.joined(separator: "\n\n")
    }

    init(interruption: XDriveIOSNativeLaunchCheckpoint.Interruption?) {
        self.interruption = interruption
        _normalStartup = State(initialValue: interruption == nil)
    }

    var body: some View {
        Group {
            if normalStartup {
                XDriveIOSNativeOwnerLoginScreen(
                    safeStartup: safeStartup,
                    diagnosticWorkspace: diagnosticWorkspace,
                    priorDiagnostic: diagnosticWorkspace ? diagnosticSummary : nil
                )
            } else {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            Label("上一次启动或登录后切换未完成",
                                  systemImage: "exclamationmark.triangle")
                                .font(.title3.weight(.semibold))
                            Text("上次进程结束时仍处于初始化阶段：可能是闪退，也可能是强制退出。已暂停自动登录和前台备份；不会删除登录资料、照片或备份收据。")
                                .foregroundStyle(.secondary)
                            Text("上一次阶段：\(interruption?.phase.rawValue ?? "unknown")")
                                .font(.footnote.monospaced())
                                .textSelection(.enabled)
                                .accessibilityIdentifier("native-ios-startup-phase")
                            if let step = interruption?.lastStep {
                                Text("最后执行步骤：\(step.rawValue)")
                                    .font(.footnote.monospaced())
                                    .textSelection(.enabled)
                                    .accessibilityIdentifier("native-ios-postlogin-crash-step")
                            }
                            if let date = interruption?.lastStepAt {
                                Text("记录时间（UTC）：\(ISO8601DateFormatter().string(from: date))")
                                    .font(.footnote.monospaced())
                                    .textSelection(.enabled)
                            }
                            if let metricDiagnostic {
                                Text("系统诊断（可能来自更早的一次崩溃）：")
                                    .font(.subheadline.weight(.medium))
                                Text(metricDiagnostic)
                                    .font(.footnote.monospaced())
                                    .textSelection(.enabled)
                                    .accessibilityIdentifier("native-ios-system-crash-diagnostic")
                            }
                            Text("该步骤不是系统崩溃堆栈。fatalError、数组越界或非法内存访问不能安全地在进程内捕获后继续显示 UI。")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Button("复制诊断摘要（不含凭据）") {
                                UIPasteboard.general.string = diagnosticSummary
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("native-ios-startup-copy-diagnostics")
                            Button("诊断登录（验证账号，暂不加载主界面）") {
                                XDriveIOSNativeLaunchCheckpoint.mark(.initializing)
                                safeStartup = true
                                diagnosticWorkspace = true
                                normalStartup = true
                            }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("native-ios-startup-diagnostic-login")
                            Button("安全进入（不自动登录和备份）") {
                                XDriveIOSNativeLaunchCheckpoint.mark(.initializing)
                                safeStartup = true
                                diagnosticWorkspace = false
                                normalStartup = true
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("native-ios-startup-safe-entry")
                            Button("尝试完整重新启动原生客户端") {
                                XDriveIOSNativeLaunchCheckpoint.mark(.initializing)
                                safeStartup = false
                                diagnosticWorkspace = false
                                normalStartup = true
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("native-ios-startup-retry")
                            Text("如再次退出：iPhone 设置 → 隐私与安全性 → 分析与改进 → 分析数据，提供对应时间的 xDrive .ips 文件。诊断摘要可定位最后阶段；真正的异常类型和调用栈需要 .ips。")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .padding(24)
                        .frame(maxWidth: 480, alignment: .leading)
                    }
                    .navigationTitle("启动恢复与诊断")
                }
                .accessibilityIdentifier("native-ios-startup-recovery")
                .onAppear {
                    XDriveIOSNativeLaunchCheckpoint.mark(.recovery)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(
            for: XDriveIOSNativeCrashMetricCollector.notification
        )) { _ in
            metricDiagnostic = XDriveIOSNativeCrashMetricCollector.latestSummary
        }
    }
}
