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
    @Published private(set) var manualUploadMessage: String?
    @Published private(set) var manualUploadBusy = false
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
        guard !isLoading && !manualUploadBusy else { return }
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
        guard !isLoading && !manualUploadBusy else { return }
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

    /// Explicit, foreground-only single-file upload. It deliberately does
    /// not create a PhotoKit sync ledger, device binding or Live photo receipt.
    func uploadManualDocument(_ pickedURL: URL) async {
        guard !isLoading && !manualUploadBusy,
              let owner = verifiedOwner,
              let session = activeSession,
              let token = activeAccessToken, !token.isEmpty,
              owner.origin == session.origin,
              owner.username == signedInName else {
            manualUploadMessage = "先验证当前原生 Owner/云端根目录，之后才能上传。"
            return
        }
        manualUploadBusy = true
        manualUploadMessage = "正在准备本机文件（尚未上传）…"
        defer { manualUploadBusy = false }
        do {
            let staged = try await XDriveManualDocumentStager.stage(pickedURL)
            defer { staged.delete() }
            try Task.checkCancellation()
            // The Owner/root GET uses the same current access token and
            // HTTPS origin; a stale Owner/Server/Root can never write bytes.
            let latest = try await XDriveNativeOwnerRootVerifier(
                origin: owner.origin, accessToken: token,
                expectedUsername: owner.username
            ).verify()
            guard latest.origin == owner.origin,
                  latest.instanceID == owner.instanceID,
                  latest.ownerID == owner.ownerID,
                  latest.rootNodeID == owner.rootNodeID,
                  activeSession?.refreshToken == session.refreshToken,
                  signedInName == owner.username else {
                manualUploadMessage = "Owner/服务器根目录已改变，未上传文件。"
                return
            }
            try Task.checkCancellation()
            manualUploadMessage = "向已验证 Owner 根目录提交文件，等待 Server 确认…"
            let transport = try XDriveNativeUploadSessionTransport(
                origin: latest.origin, accessToken: token
            )
            let receipt = try await transport.uploadOnce(
                from: staged.fileURL,
                name: staged.originalName,
                parentID: latest.rootNodeID
            )
            try Task.checkCancellation()
            manualUploadMessage = "Server 已确认保存：\(receipt.nodeName)，Node #\(receipt.nodeID)，修订 \(receipt.revision)。这是单文件上传，不是相册备份。"
            verifiedOwner = latest
        } catch is CancellationError {
            manualUploadMessage = "已停止本机请求；服务端可能有未完成会话或已提交的文件，请在云端核实后再操作。"
        } catch XDriveManualDocumentStageError.tooLarge {
            manualUploadMessage = "首版原生手动上传限制 128 MiB，请用共用 PWA 上传更大的文件。"
        } catch XDriveManualDocumentStageError.invalidName {
            manualUploadMessage = "文件名不符合 xDrive 服务端兼容规则，未上传。"
        } catch XDriveManualDocumentStageError.notAnAccessibleFile {
            manualUploadMessage = "无法取得所选文件的可读本机副本，未开始上传。"
        } catch {
            // Never equate a lost/invalid Server ACK with a safe retry.
            manualUploadMessage = "未能确认 Server 最终提交。请先在云端根目录核实，勿直接重复上传。"
        }
    }

    func logout() async {
        guard !isLoading && !manualUploadBusy else { return }
        let old = activeSession
        KeychainSessionStore.clear()
        activeSession = nil
        activeAccessToken = nil
        verifiedOwner = nil
        ownerVerificationMessage = nil
        manualUploadMessage = nil
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
