import Combine
import SwiftUI

/// Native Owner-verified app root. A single controller owns the auto runner;
/// the account card is shown ONLY while signed out, never behind a push route.
struct XDriveIOSNativeOwnerLoginScreen: View {
    @StateObject private var model = XDriveIOSNativeOwnerLoginModel()
    @StateObject private var backup = XDriveIOSNativePhotoBackupController()
    @Environment(\.scenePhase) private var phase
    @State private var showPassword = false
    @State private var logoutWarning: String?
    @State private var signingOut = false

    var body: some View {
        Group {
            if model.owner != nil {
                XDriveIOSNativePhotosDashboard(
                    login: model, backup: backup,
                    signingOut: signingOut, logoutWarning: logoutWarning,
                    onSignOut: { expected in
                        Task { await signOutSafely(expectedOwner: expected) }
                    }
                )
            } else {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            HStack(spacing: 12) {
                                Image("Brand")
                                    .resizable()
                                    .scaledToFit()
                                    .frame(width: 48, height: 48)
                                    .accessibilityLabel("xDrive")
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("xDrive")
                                        .font(.title.bold())
                                    Text("iOS 原生客户端")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Text("连接到你的个人云端")
                                .font(.title3.weight(.semibold))

                            loginForm
                            if let logoutWarning {
                                Text(logoutWarning)
                                    .foregroundStyle(.orange)
                                    .font(.footnote)
                                    .accessibilityIdentifier("native-ios-logout-warning")
                            }

                            if let warning = model.errorMessage {
                                Text(warning)
                                    .foregroundStyle(.red)
                                    .font(.footnote)
                                    .accessibilityIdentifier("native-ios-login-error")
                            }
                            if let notice = model.noticeMessage {
                                Text(notice)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(24)
                        .frame(maxWidth: 430, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(Color(uiColor: .secondarySystemGroupedBackground))
                        )
                        .padding(20)
                        .frame(maxWidth: .infinity)
                    }
                    .background(Color(uiColor: .systemGroupedBackground))
                    .navigationTitle("xDrive")
                    .navigationBarTitleDisplayMode(.inline)
                }
            }
        }
        .task {
            // Restore must verify Server instance, Owner and cloud root first.
            await model.restore()
            backup.refresh(owner: model.owner)
            if phase == .active { backup.tickIfDue(login: model) }
        }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
            guard phase == .active else { return }
            backup.tickIfDue(login: model)
        }
        .onChange(of: phase) { state in
            if state == .active { backup.tickIfDue(login: model) }
            else { backup.cancel() }
        }
        .onChange(of: model.owner) { _ in
            backup.cancel()
            backup.refresh(owner: model.owner)
            if model.owner == nil { showPassword = false }
            if phase == .active { backup.tickIfDue(login: model) }
        }
    }

    private var loginForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("服务器 HTTPS 地址").font(.subheadline.weight(.medium))
            TextField("https://drive.example.com", text: $model.serverText)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.URL)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("native-ios-login-server")

            Text("用户名").font(.subheadline.weight(.medium))
            TextField("用户名", text: $model.username)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("native-ios-login-username")

            Text("密码").font(.subheadline.weight(.medium))
            HStack {
                Group {
                    if showPassword {
                        TextField("密码", text: $model.password)
                    } else {
                        SecureField("密码", text: $model.password)
                    }
                }
                .textContentType(.password)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                Button {
                    showPassword.toggle()
                } label: {
                    Image(systemName: showPassword ? "eye.slash" : "eye")
                }
                .accessibilityLabel(showPassword ? "隐藏密码" : "显示密码")
            }
            .textFieldStyle(.roundedBorder)
            .accessibilityIdentifier("native-ios-login-password")

            Toggle("保持登录", isOn: $model.keepSignedIn)
            Button {
                Task { await model.signIn() }
            } label: {
                HStack {
                    if model.busy { ProgressView() }
                    Text(model.busy ? "正在验证…" : "登录")
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.busy)
            .accessibilityIdentifier("native-ios-login-submit")

            Text("仅使用原生 HTTPS 会话；不会读取或复制 PWA Cookie。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .disabled(model.busy)
    }

    /// No new account may reuse a prior owner's pending foreground or
    /// BG grant. Fail closed if the global original writer is still active.
    @MainActor
    private func signOutSafely(expectedOwner: XDriveNativeOwnerRoot) async {
        guard !signingOut,
              XDriveIOSNativePhotoOwnerScope.matches(model.owner, expectedOwner) else {
            logoutWarning = "当前服务器或账号已变化；未退出另一账户。"
            return
        }
        signingOut = true
        defer { signingOut = false }
        logoutWarning = nil
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            logoutWarning = "已有原件操作正在结束，请先返回相册停止本轮后重试退出。"
            return
        }
        defer { XDriveIOSOriginalRunGate.shared.release(gate) }
        XDriveIOSPhotoAutoScheduleStore.shared.disableAllOnThisDevice()
        XDriveIOSBackgroundPhotoTask.revokePendingRequests()
        do {
            let remotePending = try await XDriveIOSPhotoBackgroundGrantManager.shared
                .emergencyStopLocally()
            guard XDriveIOSNativePhotoOwnerScope.matches(model.owner, expectedOwner) else {
                logoutWarning = "账户在安全退出过程中变化，未操作另一账户。"
                return
            }
            // The direct native root has no intermediate account page.
            // Explicit logout must retire saved Gallery navigation too.
            XDriveIOSNativeNavigationRouteStore().clear()
            await model.signOut()
            if remotePending {
                logoutWarning = "本机自动上传已停止；旧服务器的授权撤销待网络恢复后复核。"
            }
        } catch {
            logoutWarning = "无法确认旧账户后台凭据已清除。为防止跨账户自动备份，本次未切换账户。请解锁 Keychain 后重试。"
        }
    }

}
