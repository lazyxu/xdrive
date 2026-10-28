import Combine
import Foundation

@MainActor
final class LoginViewModel: ObservableObject {
    @Published var server: String = ""
    @Published var username: String = ""
    @Published var password: String = ""
    @Published var keepLogin = true
    @Published private(set) var isLoading = false
    @Published private(set) var signedInName: String?
    @Published private(set) var signedInServer: String?
    @Published private(set) var verifiedOwner: XDriveNativeOwnerRoot?
    @Published private(set) var ownerVerificationMessage: String?
    @Published private(set) var errorMessage: String?
    @Published private(set) var noticeMessage: String?

    private var didRestore = false
    private var activeSession: (origin: URL, refreshToken: String)?
    // Never persist or expose this short-lived Bearer to WKWebView.
    private var activeAccessToken: String?

    init() {
        if let saved = KeychainSessionStore.load() {
            server = saved.server
            username = saved.username
        } else {
            server = UserDefaults.standard.string(forKey: "xdrive.ios.server") ?? ""
            username = UserDefaults.standard.string(forKey: "xdrive.ios.username") ?? ""
        }
    }

    func restore() async {
        guard !didRestore else { return }
        didRestore = true
        guard let saved = KeychainSessionStore.load() else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let origin = try ServerAddress.parse(saved.server)
            let result = try await AuthService(origin: origin).refresh(token: saved.refreshToken)
            if result.must_change_password == true {
                KeychainSessionStore.clear()
                errorMessage = "账户需要修改密码，请先通过 xDrive 网页完成修改。"
                return
            }
            activeSession = (origin, result.refresh_token)
            activeAccessToken = [result.access_token, result.token].compactMap { $0 }.first { !$0.isEmpty }
            verifiedOwner = nil
            ownerVerificationMessage = nil
            signedInName = result.username
            signedInServer = origin.host
            // A refresh may rotate the credential. Never keep the old token.
            do {
                try KeychainSessionStore.save(StoredCredential(
                    server: origin.absoluteString,
                    username: result.username,
                    refreshToken: result.refresh_token
                ))
            } catch {
                noticeMessage = "登录已恢复，但无法保存新的保持登录凭据。"
            }
        } catch {
            if let failure = error as? AuthFailure, case .rejected = failure {
                KeychainSessionStore.clear()
                errorMessage = "保持登录已失效，请重新输入密码。"
            } else {
                // Temporary outages do not destroy the stored refresh credential.
                errorMessage = "自动恢复登录失败：\(AuthFailure.message(for: error))"
            }
        }
    }

    func login() async {
        guard !isLoading else { return }
        errorMessage = nil
        noticeMessage = nil
        verifiedOwner = nil
        ownerVerificationMessage = nil
        activeAccessToken = nil
        let account = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !account.isEmpty, !password.isEmpty else {
            errorMessage = "请填写用户名和密码。"
            return
        }
        let origin: URL
        do {
            origin = try ServerAddress.parse(server)
        } catch {
            errorMessage = AuthFailure.message(for: error)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await AuthService(origin: origin).login(username: account, password: password)
            password = ""
            if result.must_change_password == true {
                errorMessage = "账户需要修改密码，请先通过 xDrive 网页完成修改后重新登录。"
                return
            }
            activeSession = (origin, result.refresh_token)
            activeAccessToken = [result.access_token, result.token].compactMap { $0 }.first { !$0.isEmpty }
            verifiedOwner = nil
            ownerVerificationMessage = nil
            signedInName = result.username
            signedInServer = origin.host
            server = origin.absoluteString
            username = result.username
            UserDefaults.standard.set(server, forKey: "xdrive.ios.server")
            UserDefaults.standard.set(username, forKey: "xdrive.ios.username")

            if keepLogin {
                do {
                    try KeychainSessionStore.save(StoredCredential(
                        server: server,
                        username: result.username,
                        refreshToken: result.refresh_token
                    ))
                } catch {
                    noticeMessage = "登录成功，但未能保存保持登录凭据；退出应用后可能需要重新登录。"
                }
            } else {
                KeychainSessionStore.clear()
            }
        } catch {
            password = ""
            errorMessage = AuthFailure.message(for: error)
        }
    }

    /// Explicit read-only Owner verification. A successful native login alone
    /// does NOT authorize a Device/Root backup or establish a sync checkpoint.
    func verifyOwnerRoot() async {
        guard !isLoading else { return }
        verifiedOwner = nil
        ownerVerificationMessage = nil
        guard let current = activeSession,
              let accessToken = activeAccessToken, !accessToken.isEmpty,
              let ownerName = signedInName else {
            ownerVerificationMessage = "当前没有有效的原生登录会话。"
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let found = try await XDriveNativeOwnerRootVerifier(
                origin: current.origin,
                accessToken: accessToken,
                expectedUsername: ownerName
            ).verify()
            guard activeSession?.origin == current.origin,
                  activeSession?.refreshToken == current.refreshToken,
                  signedInName == ownerName else {
                ownerVerificationMessage = "会话在验证过程中发生变化，已丢弃旧结果。"
                return
            }
            verifiedOwner = found
        } catch {
            ownerVerificationMessage = "Owner/根目录验证失败：请检查连接、服务端身份及会话状态。不会启动照片备份。"
        }
    }

    func logout() async {
        guard !isLoading else { return }
        let old = activeSession
        KeychainSessionStore.clear()
        activeSession = nil
        activeAccessToken = nil
        verifiedOwner = nil
        ownerVerificationMessage = nil
        signedInName = nil
        signedInServer = nil
        errorMessage = nil
        noticeMessage = nil
        password = ""
        guard let old else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            try await AuthService(origin: old.origin).logout(token: old.refreshToken)
        } catch {
            noticeMessage = "本机已退出，服务端会话撤销尚未确认。"
        }
    }
}
