import Combine
import SwiftUI

/// Native iOS owner root. The native foreground auto runner must survive
/// leaving the Photos dashboard while the app and Owner session stay active.
struct XDriveIOSNativeOwnerLoginScreen: View {
    @StateObject private var model = XDriveIOSNativeOwnerLoginModel()
    // Own a single native auto runner for the entire authenticated foreground
    // scene, rather than recreating it on every gallery/dashboard navigation.
    @StateObject private var backup = XDriveIOSNativePhotoBackupController()
    @Environment(\.scenePhase) private var phase
    @State private var showPassword = false
    @State private var logoutWarning: String?
    @State private var restoreFinished = false
    @State private var signOutBusy = false
    @State private var emergencyStopBusy = false
    @State private var emergencyStopNotice: String?

    var body: some View {
        Group {
            // Restoring Keychain credentials must finish with a fresh Owner/root
            // proof before either the sign-in form or native tabs are shown.
            if !restoreFinished {
                ProgressView("正在验证本机账户…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.owner != nil {
                // The verified workspace IS the root, not a push destination.
                // Back gestures can no longer reveal an authenticated login
                // interstitial. The one durable backup runner stays here.
                XDriveIOSNativePhotosDashboard(
                    login: model, backup: backup,
                    onSignOut: { Task { await signOutSafely() } },
                    signingOut: signOutBusy,
                    logoutWarning: logoutWarning
                )
            } else {
                NavigationStack {
                    loginPage
                }
            }
        }
        .task {
            await model.restore()
            restoreFinished = true
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
            // Never retain a previous Server/Owner's in-flight foreground
            // upload when authentication changes.
            backup.cancel()
            backup.refresh(owner: model.owner)
            if phase == .active { backup.tickIfDue(login: model) }
            if model.owner != nil { logoutWarning = nil }
        }
    }

    private var loginPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Image("Brand")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 48, height: 48)
                        .accessibilityLabel("xDrive")
                    VStack(alignment: .leading, spacing: 3) {
                        Text("xDrive").font(.title.bold())
                        Text("iOS 原生客户端")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Text("连接到你的个人云端")
                    .font(.title3.weight(.semibold))
                loginForm
                if let error = model.errorMessage {
                    Text(error).foregroundStyle(.red).font(.footnote)
                        .accessibilityIdentifier("native-ios-login-error")
                }
                if let warning = logoutWarning {
                    Text(warning).foregroundStyle(.orange).font(.footnote)
                }
                if let notice = model.noticeMessage {
                    Text(notice).font(.footnote).foregroundStyle(.secondary)
                }
                // Stop-only action remains accessible when login or Keychain
                // verification is impossible, without restoring a Web screen.
                Button("紧急停止本机相册自动备份", role: .destructive) {
                    Task { await emergencyStopWithoutAccount() }
                }
                .disabled(emergencyStopBusy)
                .accessibilityIdentifier("native-ios-offline-emergency-stop")
                if let emergencyStopNotice {
                    Text(emergencyStopNotice)
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

    /// Stop-only fallback for an offline/locked native login, not a WebView.
    /// Existing encrypted receipts and the v2 Owner session are untouched.
    @MainActor
    private func emergencyStopWithoutAccount() async {
        guard !emergencyStopBusy else { return }
        emergencyStopBusy = true
        defer { emergencyStopBusy = false }
        // A prior upload may still be winding down; stop this scene's runner
        // before revoking any persisted plans or background credentials.
        backup.cancel()
        let stopped = XDriveIOSPhotoAutoScheduleStore.shared.disableAllOnThisDevice()
        XDriveIOSBackgroundPhotoTask.revokePendingRequests()
        do {
            let pendingRemote = try await XDriveIOSPhotoBackgroundGrantManager.shared
                .emergencyStopLocally()
            emergencyStopNotice = pendingRemote
                ? "已停用本机 \(stopped) 个前台计划与后台任务；联网后须核对远端授权。"
                : "已停用本机 \(stopped) 个前台计划并取消后台任务。"
        } catch {
            emergencyStopNotice = "已停用本机 \(stopped) 个前台计划；后台 Keychain 清除尚未确认，请解锁后重试。"
        }
    }

    /// No new account may reuse a prior owner's pending foreground or
    /// BG grant. Fail closed if the global original writer is still active.
    @MainActor
    private func signOutSafely() async {
        guard !signOutBusy else { return }
        signOutBusy = true
        defer { signOutBusy = false }
        logoutWarning = nil
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            logoutWarning = "已有原件操作正在结束，请先在「相册备份」取消本轮后重试退出。"
            return
        }
        defer { XDriveIOSOriginalRunGate.shared.release(gate) }
        XDriveIOSPhotoAutoScheduleStore.shared.disableAllOnThisDevice()
        XDriveIOSBackgroundPhotoTask.revokePendingRequests()
        do {
            let remotePending = try await XDriveIOSPhotoBackgroundGrantManager.shared
                .emergencyStopLocally()
            await model.signOut()
            // Root conditionally unmounts the dashboard on logout, so its
            // onChange cannot be relied upon to erase persisted route hints.
            XDriveIOSNativeNavigationRouteStore().clear()
            if remotePending {
                logoutWarning = "本机自动上传已停止；旧服务器的授权撤销待网络恢复后复核。"
            }
        } catch {
            logoutWarning = "无法确认旧账户后台凭据已清除。为防止跨账户自动备份，本次未切换账户。请解锁 Keychain 后重试。"
        }
    }

}
