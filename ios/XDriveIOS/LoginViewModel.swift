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
    @Published private(set) var photoBackupBusy = false
    @Published private(set) var photoBackupProgress: XDriveIOSPhotoBackupProgress?
    @Published private(set) var photoBackupMessage: String?
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

    /// User-selected regular still photo only; no automatic sync or Live
    /// Photo half-pair fallback. The native/PWA sessions remain independent.
    func uploadSelectedStillPhoto(_ localIdentifier: String,
                                  allowICloudOriginal: Bool) async -> String {
        guard !isLoading && !manualUploadBusy,
              let owner = verifiedOwner,
              let session = activeSession,
              let token = activeAccessToken, !token.isEmpty,
              owner.origin == session.origin,
              owner.username == signedInName else {
            return "请先在原生登录页验证当前 Owner 与云端根目录。"
        }
        manualUploadBusy = true
        manualUploadMessage = "正在检查选中的系统照片和原件权限…"
        defer { manualUploadBusy = false }
        let message: String
        do {
            let receipt = try await XDriveIOSManualPhotoOriginalUpload(
                owner: owner, accessToken: token
            ).upload(
                localIdentifier: localIdentifier,
                allowICloudOriginal: allowICloudOriginal
            )
            message = "Server 已确认保存照片原始文件：\(receipt.nodeName)，Node #\(receipt.nodeID)。这不是自动相册同步或完整 PhotoAsset 备份。"
        } catch is CancellationError {
            message = "请求已取消；如果服务器已提交但 ACK 丢失，仍可能存在文件，请先核实云端后再重试。"
        } catch XDriveIOSManualPhotoUploadFailure.livePairNotSupported {
            message = "Live Photo 需要静态图与配对视频一起持久提交；当前手动功能拒绝只备份静态图。"
        } catch XDriveIOSManualPhotoUploadFailure.videoNotSupported {
            message = "此入口只支持单张普通照片，视频请使用现有文件上传功能。"
        } catch XDrivePhotoKitExportFailure.resourceTooLarge {
            message = "所选照片原件超过 128 MiB，未开始上传。"
        } catch XDrivePhotoKitExportFailure.notAuthorized {
            message = "iOS 照片授权已撤销或不再可用，未上传。"
        } catch XDrivePhotoKitExportFailure.assetNotVisible {
            message = "所选照片已不在当前 iOS 授权范围内，未上传。"
        } catch XDriveIOSManualPhotoUploadFailure.ownerChanged {
            message = "服务器实例或账户根目录已变化，已停止照片上传。"
        } catch {
            // No server-reported completed ACK => never show "backup succeeded".
            message = "无法确认照片是否已提交。可能是 iCloud 原件不可用、文件冲突或网络 ACK 丢失；请先核对云端，不要直接重复上传。"
        }
        manualUploadMessage = message
        return message
    }

    /// The first user-visible, bounded iOS Photos cloud Files backup.
    /// Explicit tap only; never starts on login, Photos permission grant,
    /// background notification or ordinary PWA navigation.
    func runForegroundPhotoBackup(allowICloudOriginals: Bool) async {
        guard !isLoading && !manualUploadBusy && !photoBackupBusy,
              let owner = verifiedOwner,
              let session = activeSession,
              let token = activeAccessToken, !token.isEmpty,
              session.origin == owner.origin,
              signedInName == owner.username else {
            photoBackupMessage = "请先登录并验证当前 Owner 根目录。"
            return
        }
        manualUploadBusy = true
        photoBackupBusy = true
        photoBackupProgress = XDriveIOSPhotoBackupProgress()
        photoBackupMessage = nil
        defer {
            photoBackupBusy = false
            manualUploadBusy = false
        }
        do {
            let summary = try await XDriveIOSForegroundPhotoBackupMVP(
                owner: owner, accessToken: token
            ).run(allowICloudOriginals: allowICloudOriginals) { [weak self] latest in
                self?.photoBackupProgress = latest
            }
            if summary.stoppedForReview || summary.needsReview > 0 {
                photoBackupMessage = "有文件的 Server 提交状态尚不明确。已暂停本轮新增备份，请核实后再继续，不能把未知结果计为成功。"
            } else {
                photoBackupMessage = "本轮已完成：新上传 \(summary.uploaded)，核验后跳过 \(summary.verifiedAlready)。Live Photo、视频和授权外项目未标记备份完成。"
            }
        } catch is CancellationError {
            photoBackupMessage = "本轮已取消。已确认的文件仍在云端；中断中的操作可能需要 Server 回读，不会自动重复上传。"
        } catch XDrivePhotoKitScanFailure.notAuthorized {
            photoBackupMessage = "当前未取得完整或受限相册访问权限，请在 iOS 系统授权后再尝试。"
        } catch XDrivePhotoKitScanFailure.snapshotChanged {
            photoBackupMessage = "相册内容或授权发生变化，本次扫描已终止；请重新检查。"
        } catch {
            photoBackupMessage = "本轮备份停止：请检查原生 Owner 会话、相册授权和受保护的本地账本。未获得 Server 收据的文件不能标记完成。"
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
        photoBackupProgress = nil
        photoBackupMessage = nil
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
