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
    @State private var showingNativeWorkspace = false

    var body: some View {
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
                    Text(model.owner == nil ? "连接到你的个人云端" : "已验证的原生账户")
                        .font(.title3.weight(.semibold))

                    if let verified = model.owner {
                        verifiedAccount(verified)
                    } else {
                        loginForm
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
            .navigationDestination(isPresented: $showingNativeWorkspace) {
                XDriveIOSNativePhotosDashboard(login: model, backup: backup)
            }
        }
        .task {
            await model.restore()
            // Restoration must prove the original Server Owner and root.
            // Only a verified native account enters the Photos-first workspace.
            if model.owner != nil { showingNativeWorkspace = true }
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
            // A late response from the previous Server/Owner may not keep
            // uploading after native session changes or disappears.
            backup.cancel()
            backup.refresh(owner: model.owner)
            if phase == .active { backup.tickIfDue(login: model) }
            showingNativeWorkspace = model.owner != nil
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

            Text("内网 IP（可选）").font(.subheadline.weight(.medium))
            TextField("192.168.2.4", text: $model.lanIPText)
                .keyboardType(.numbersAndPunctuation)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("native-ios-login-lan-ip")
            Text("登录前检测一次内网 HTTPS；不可达或超时才使用上方域名。登录后固定已选入口，不自动切换；内网证书必须匹配 IP。")
                .font(.caption)
                .foregroundStyle(.secondary)

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

    private func verifiedAccount(_ verified: XDriveNativeOwnerRoot) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("当前服务器与 Owner 已验证", systemImage: "checkmark.shield.fill")
            Text(verified.origin.host ?? "xDrive")
            Text(verified.username)
            Text("Owner #\(verified.ownerID) · Root #\(verified.rootNodeID)")
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
            Text("本机相册、原件自动增量备份及云端已备份文件查看已提供原生入口。完整 Files 和云端 Live ZIP 动态播放仍在迁移。")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button {
                showingNativeWorkspace = true
            } label: {
                Label("打开原生相册与自动备份", systemImage: "photo.stack")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("native-ios-photos-open")
            if let logoutWarning {
                Text(logoutWarning).foregroundStyle(.red).font(.footnote)
            }
            Button("退出原生账户", role: .destructive) {
                Task { await signOutSafely() }
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("native-ios-login-signout")
        }
    }
    /// No new account may reuse a prior owner's pending foreground or
    /// BG grant. Fail closed if the global original writer is still active.
    @MainActor
    private func signOutSafely() async {
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
            await model.signOut()
            if remotePending {
                logoutWarning = "本机自动上传已停止；旧服务器的授权撤销待网络恢复后复核。"
            }
        } catch {
            logoutWarning = "无法确认旧账户后台凭据已清除。为防止跨账户自动备份，本次未切换账户。请解锁 Keychain 后重试。"
        }
    }

}
