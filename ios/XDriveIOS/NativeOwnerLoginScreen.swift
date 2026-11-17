import Combine
import SwiftUI
import UIKit

/// Native Owner-verified app root. A single controller owns the auto runner;
/// the account card is shown ONLY while signed out, never behind a push route.
struct XDriveIOSNativeOwnerLoginScreen: View {
    var safeStartup = false

    @StateObject private var model = XDriveIOSNativeOwnerLoginModel()
    @StateObject private var backup = XDriveIOSNativePhotoBackupController()
    @Environment(\.scenePhase) private var phase
    @State private var showPassword = false
    @State private var logoutWarning: String?
    @State private var signingOut = false
    @State private var restoreFinished = false
    @State private var workspaceVisible = false
    @State private var startupReady = false
    @State private var readinessTicket = UUID()
    @State private var readinessTask: Task<Void, Never>?
    @State private var clearSavedLoginConfirm = false
    @State private var emergencyStopBusy = false
    @State private var emergencyStopNotice: String?
    // Presentation state only. Authentication, Keychain, TLS and backup
    // protection stay in the existing native model/controllers.
    @State private var showAdvancedConnection = false
    @State private var showLANHelp = false
    @State private var showLoginPreferences = false
    @State private var showHelpAndEmergency = false
    @State private var showAbout = false
    @State private var showErrorDetails = false
    @State private var showNoticeDetails = false

    var body: some View {
        Group {
            // Suppress the signed-out form until native Keychain restoration
            // has proved the exact Server instance, Owner and cloud root.
            if !restoreFinished {
                ProgressView("正在验证本机账户…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.owner != nil {
                XDriveIOSNativePhotosDashboard(
                    login: model, backup: backup,
                    signingOut: signingOut, logoutWarning: logoutWarning,
                    onSignOut: { expected in
                        Task { await signOutSafely(expectedOwner: expected) }
                    }
                )
                .onAppear { workspaceAppeared() }
                .onDisappear { workspaceDisappeared() }
            } else {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            // The navigation bar is the single xDrive brand
                            // title; no second logo/title/subtitle stack.
                            loginForm
                            if let logoutWarning {
                                Text(logoutWarning)
                                    .foregroundStyle(.orange)
                                    .font(.footnote)
                                    .accessibilityIdentifier("native-ios-logout-warning")
                            }

                            if let warning = model.errorMessage {
                                VStack(alignment: .leading, spacing: 8) {
                                    Label(compactFeedback(warning, isError: true),
                                          systemImage: "exclamationmark.triangle")
                                        .foregroundStyle(.red)
                                        .font(.footnote)
                                        .accessibilityIdentifier("native-ios-login-error")
                                    HStack(spacing: 16) {
                                        Button(showErrorDetails ? "收起详情" : "查看详情") {
                                            showErrorDetails.toggle()
                                        }
                                        .accessibilityIdentifier("native-ios-login-error-details-toggle")
                                        if !model.lanIPText.isEmpty &&
                                           (warning.contains("证书") || warning.contains("HTTPS") ||
                                            warning.contains("TLS") || warning.contains("第 3 步")) {
                                            Button("检查内网连接") {
                                                showAdvancedConnection = true
                                            }
                                            .accessibilityIdentifier("native-ios-lan-open-advanced-on-error")
                                        }
                                    }
                                    .font(.footnote)
                                    if showErrorDetails {
                                        Text(warning)
                                            .font(.footnote)
                                            .textSelection(.enabled)
                                            .accessibilityIdentifier("native-ios-login-error-detail")
                                        Text(XDriveIOSNativeBuildIdentity.label)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .textSelection(.enabled)
                                            .accessibilityIdentifier("native-ios-prelogin-build")
                                        Button("复制诊断信息") {
                                            // humanMessage() already emits sanitized data;
                                            // never append username, password or credentials.
                                            UIPasteboard.general.string =
                                                String((warning + "\n" +
                                                    XDriveIOSNativeBuildIdentity.label).prefix(2048))
                                        }
                                        .accessibilityIdentifier("native-ios-login-copy-diagnostics")
                                    }
                                    // A failed session restore may be retried explicitly,
                                    // but no stored password is replayed automatically.
                                    if model.canRetryStoredSessionForCurrentDraft {
                                        Button("重试恢复已保存的登录") {
                                            Task { await model.retryStoredSession() }
                                        }
                                        .buttonStyle(.bordered)
                                        .disabled(model.busy)
                                        .accessibilityIdentifier("native-ios-saved-session-retry")
                                    }
                                }
                            }
                            if let notice = model.noticeMessage {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(compactFeedback(notice, isError: false))
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .accessibilityIdentifier("native-ios-login-notice")
                                    if notice.count > 70 {
                                        Button(showNoticeDetails ? "收起操作详情" : "查看操作详情") {
                                            showNoticeDetails.toggle()
                                        }
                                        .font(.footnote)
                                        .accessibilityIdentifier("native-ios-login-notice-details-toggle")
                                        if showNoticeDetails {
                                            Text(notice)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .textSelection(.enabled)
                                                .accessibilityIdentifier("native-ios-login-notice-detail")
                                        }
                                    }
                                }
                            }
                            helpAndEmergency
                            aboutSection
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
                    .onChange(of: model.errorMessage) { _ in showErrorDetails = false }
                    .onChange(of: model.noticeMessage) { _ in showNoticeDetails = false }
                    .navigationTitle("xDrive")
                    .navigationBarTitleDisplayMode(.inline)
                }
                .onAppear { workspaceAppeared() }
                .onDisappear { workspaceDisappeared() }
            }
        }
        .onDisappear {
            readinessTicket = UUID()
            readinessTask?.cancel()
            readinessTask = nil
            backup.stopLibraryChangeMonitoring()
        }
        .task {
            // This task can be cancelled when SwiftUI replaces the transient
            // login/progress subtree with the Dashboard. Never couple the
            // durable ready marker to this task's sleep or cancellation.
            guard !restoreFinished else { return }
            if !safeStartup {
                XDriveIOSNativeLaunchCheckpoint.mark(.retiringCredential)
                XDriveIOSRetiredNativeLogin.purgeLegacyRefreshToken()
                XDriveIOSNativeLaunchCheckpoint.mark(.restoringSession)
                // Restore must verify Server instance, Owner and cloud root.
                await model.restore()
            }
            guard !Task.isCancelled else { return }
            XDriveIOSNativeLaunchCheckpoint.mark(.mountingWorkspace)
            backup.refresh(owner: model.owner)
            restoreFinished = true
        }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
            guard XDriveIOSNativeLaunchCheckpoint.mayAutoBackup(
                startupReady: startupReady, safeStartup: safeStartup,
                foreground: phase == .active
            ) else { return }
            backup.tickIfDue(login: model)
        }
        .onChange(of: phase) { state in
            if state == .active {
                if startupReady {
                    if XDriveIOSNativeLaunchCheckpoint.mayAutoBackup(
                        startupReady: startupReady, safeStartup: safeStartup,
                        foreground: true
                    ) {
                        backup.startLibraryChangeMonitoring(login: model)
                        backup.tickIfDue(login: model)
                    }
                } else {
                    armReadinessAfterMount()
                }
            } else {
                readinessTicket = UUID()
                readinessTask?.cancel()
                readinessTask = nil
                backup.stopLibraryChangeMonitoring()
                backup.cancel()
            }
        }
        // Re-arm readiness when the actual post-restore workspace mounts.
        // This never grants Owner access or starts automatic backup before
        // its existing foreground + stabilized readiness gate succeeds.
        .onChange(of: restoreFinished) { finished in
            if finished { armReadinessAfterMount() }
        }
        .onChange(of: workspaceVisible) { visible in
            if visible { armReadinessAfterMount() }
        }
        .onChange(of: model.owner) { _ in
            backup.cancel()
            backup.refresh(owner: model.owner)
            if model.owner == nil { showPassword = false }
            guard XDriveIOSNativeLaunchCheckpoint.mayAutoBackup(
                startupReady: startupReady, safeStartup: safeStartup,
                foreground: phase == .active
            ) else { return }
            backup.tickIfDue(login: model)
        }
    }

    @MainActor
    private func workspaceAppeared() {
        workspaceVisible = true
        armReadinessAfterMount()
    }

    @MainActor
    private func workspaceDisappeared() {
        workspaceVisible = false
        readinessTicket = UUID()
        readinessTask?.cancel()
        readinessTask = nil
    }

    @MainActor
    private func armReadinessAfterMount() {
        guard !startupReady,
              XDriveIOSNativeLaunchCheckpoint.mayFinishStartup(
                restoreComplete: restoreFinished, workspaceVisible: workspaceVisible,
                foreground: phase == .active
              ) else { return }
        // Independent of the session-restore .task: SwiftUI can cancel that
        // task as soon as its progress view becomes the native workspace.
        readinessTicket = UUID()
        let ticket = readinessTicket
        readinessTask?.cancel()
        readinessTask = Task { @MainActor in
            do { try await Task.sleep(nanoseconds: 3_000_000_000) }
            catch { return }
            guard !Task.isCancelled, readinessTicket == ticket, !startupReady,
                  XDriveIOSNativeLaunchCheckpoint.mayFinishStartup(
                    restoreComplete: restoreFinished, workspaceVisible: workspaceVisible,
                    foreground: phase == .active
                  ) else { return }
            XDriveIOSNativeLaunchCheckpoint.mark(.ready)
            startupReady = true
            readinessTask = nil
            // Only observe later changes; an automatic due backup never
            // starts inside the workspace-mount critical section.
            if !safeStartup {
                backup.startLibraryChangeMonitoring(login: model)
            }
        }
    }

    /// A compact default: only HTTPS Server, username, password, and Sign In.
    /// Advanced/Keychain/backup controls remain available by deliberate tap.
    private var loginForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            if safeStartup {
                Label("安全启动：本次不自动登录、清理旧凭据或运行前台自动备份。",
                      systemImage: "shield")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-startup-safe-mode")
            }

            if !model.savedProfiles.isEmpty {
                Menu {
                    ForEach(model.savedProfiles) { profile in
                        Button(profile.username + " · " + profile.server) {
                            model.chooseSavedProfile(profile)
                        }
                    }
                    if let selected = model.currentSavedProfile,
                       model.savedProfiles.contains(selected) {
                        Divider()
                        Button("忘记当前服务器和账号资料", role: .destructive) {
                            clearSavedLoginConfirm = true
                        }
                        .accessibilityIdentifier("native-ios-clear-saved-login")
                    }
                } label: {
                    Label("已保存的账号", systemImage: "person.crop.circle")
                }
                .accessibilityIdentifier("native-ios-saved-login-profiles")
            }

            Text("服务器 HTTPS 地址").font(.subheadline.weight(.medium))
            TextField("https://drive.example.com", text: $model.serverText)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.URL)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("native-ios-login-server")
                .onChange(of: model.serverText) { _ in
                    model.discardPasswordAfterIdentityEdit()
                }

            Text("用户名").font(.subheadline.weight(.medium))
            TextField("用户名", text: $model.username)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("native-ios-login-username")
                .onChange(of: model.username) { _ in
                    model.discardPasswordAfterIdentityEdit()
                }

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

            Button {
                Task {
                    // The one primary button also handles an explicitly saved
                    // password for the exact current HTTPS Server/Owner hint.
                    // A nonempty manually typed password always takes priority.
                    if model.password.isEmpty && model.savedProfilePasswordAvailable {
                        await model.signInWithSavedPassword()
                    } else {
                        await model.signIn()
                    }
                }
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
            .accessibilityValue(startupReady ? "ready" : "mounting")

            // Explicit native buttons give each collapsed section one
            // reliable 44-pt tap target and a visible, testable open state.
            compactSectionHeader(
                "高级连接设置", systemImage: "network", expanded: showAdvancedConnection
            ) { showAdvancedConnection.toggle() }
            .accessibilityIdentifier("native-ios-login-advanced-connection")
            if showAdvancedConnection {
                VStack(alignment: .leading, spacing: 10) {
                    Text("内网 IP（可选）").font(.subheadline.weight(.medium))
                    TextField("192.168.2.4", text: $model.lanIPText)
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("native-ios-login-lan-ip")
                        .onChange(of: model.lanIPText) { _ in
                            model.discardPasswordAfterIdentityEdit()
                        }
                    if !model.lanIPText.trimmingCharacters(
                        in: .whitespacesAndNewlines).isEmpty {
                        Button("配对或更新内网 HTTPS 证书") {
                            Task { await model.pairLANHTTPS() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.busy ||
                            model.serverText.trimmingCharacters(
                                in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("native-ios-lan-https-pairing")
                    }
                    compactSectionHeader(
                        "内网 HTTPS 使用说明", systemImage: "info.circle",
                        expanded: showLANHelp
                    ) { showLANHelp.toggle() }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-lan-certificate-help")
                    if showLANHelp {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("登录前检测一次内网 HTTPS；仅网络不可达或超时才使用上方域名。登录后固定已选入口，证书必须匹配内网 IP。")
                            Text("首次使用或 Caddy 根证书更换后，请在服务器所在的内网进行配对；App 会先验证域名证书，再验证内网 IP。")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
                .padding(.top, 8)
            }

            compactSectionHeader(
                "登录偏好", systemImage: "slider.horizontal.3", expanded: showLoginPreferences
            ) { showLoginPreferences.toggle() }
            .accessibilityIdentifier("native-ios-login-preferences")
            if showLoginPreferences {
                VStack(alignment: .leading, spacing: 8) {
                    // Only a direct user toggle may revoke the selected
                    // Keychain password: automatic prefill must never do so.
                    Toggle("安全保存当前账号密码", isOn: Binding(
                        get: { model.rememberPassword },
                        set: { model.setRememberPasswordFromUser($0) }
                    ))
                    .accessibilityIdentifier("native-ios-remember-password")
                    Toggle("保持登录", isOn: $model.keepSignedIn)
                        .accessibilityIdentifier("native-ios-keep-signed-in")
                }
                .padding(.top, 8)
            }
        }
        .disabled(model.busy)
        // The destructive action remains guarded by the exact selected
        // credential and by its original model-side Owner checks.
        .confirmationDialog(
            "确认只删除当前服务器和账号的本机资料？",
            isPresented: $clearSavedLoginConfirm,
            titleVisibility: .visible
        ) {
            Button("确认忘记当前账号", role: .destructive) {
                backup.cancel()
                model.clearSavedLogin()
            }
        } message: {
            Text("只删除选中服务器和用户名的本机密码档案与匹配的刷新会话，不影响其他账号、照片和备份记录。")
        }
    }

    // This is an emergency OFF operation even while signed out or offline.
    // Hiding the dangerous button must not make it unreachable without login.
    private var helpAndEmergency: some View {
        VStack(alignment: .leading, spacing: 8) {
            compactSectionHeader(
                "帮助与紧急操作", systemImage: "questionmark.circle",
                expanded: showHelpAndEmergency
            ) { showHelpAndEmergency.toggle() }
            .accessibilityIdentifier("native-ios-login-help-emergency")
            if showHelpAndEmergency {
                VStack(alignment: .leading, spacing: 10) {
                    Text("无法登录时，也可以停止本机自动备份与待执行后台任务。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("紧急停止本机相册自动备份", role: .destructive) {
                        Task { await emergencyStopWithoutAccount() }
                    }
                    .disabled(emergencyStopBusy)
                    .accessibilityIdentifier("native-ios-offline-emergency-stop")
                    if let emergencyStopNotice {
                        Text(emergencyStopNotice)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-offline-emergency-stop-result")
                    }
                }
                .padding(.top, 8)
            }
        }
    }

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            compactSectionHeader("关于", systemImage: "info.circle", expanded: showAbout) {
                showAbout.toggle()
            }
            .accessibilityIdentifier("native-ios-login-about")
            if showAbout {
                VStack(alignment: .leading, spacing: 8) {
                    Text(XDriveIOSNativeBuildIdentity.label)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("native-ios-prelogin-build")
                    Button("复制版本信息") {
                        UIPasteboard.general.string = XDriveIOSNativeBuildIdentity.label
                    }
                    .accessibilityIdentifier("native-ios-copy-version")
                }
                .padding(.top, 8)
            }
        }
    }

    /// A fully tappable native row. A conditional body disappears completely
    /// when collapsed rather than remaining in a nested accessibility group.
    private func compactSectionHeader(
        _ title: String, systemImage: String, expanded: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Label(title, systemImage: systemImage)
                Spacer(minLength: 8)
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(expanded ? "已展开" : "已收起")
    }

    private func compactFeedback(_ message: String, isError: Bool) -> String {
        if isError && message.hasPrefix("第 3 步失败") {
            return "内网 HTTPS 证书验证失败"
        }
        if isError && message.hasPrefix("第 2 步失败") {
            return "内网 HTTPS 证书配对失败"
        }
        if !isError && message.contains("已配对") {
            return "内网 HTTPS 证书已配对"
        }
        let first = message.components(separatedBy: "\n").first ?? message
        return first.count <= 70 ? first : String(first.prefix(69)) + "…"
    }

    /// Native stop-only recovery for an unavailable Owner/Server.
    /// Preserve the encrypted receipt journal and current v2 login secret.
    @MainActor
    private func emergencyStopWithoutAccount() async {
        guard !emergencyStopBusy else { return }
        emergencyStopBusy = true
        defer { emergencyStopBusy = false }
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
            // Do not expose an unauthenticated form while the old Owner's
            // Keychain refresh token is still restorable after restart.
            guard await model.signOut() else {
                logoutWarning = "本机登录凭据未能从 Keychain 清除；为防止重启后恢复旧账户，本次未退出或切换服务器。请解锁后重试。"
                return
            }
            // Only a confirmed local logout may retire Owner-scoped routes.
            XDriveIOSNativeNavigationRouteStore().clear()
            if remotePending {
                logoutWarning = "本机自动上传已停止；旧服务器的授权撤销待网络恢复后复核。"
            }
        } catch {
            logoutWarning = "无法确认旧账户后台凭据已清除。为防止跨账户自动备份，本次未切换账户。请解锁 Keychain 后重试。"
        }
    }

}
