import Foundation
import CoreFoundation
import Photos
import UIKit
import WebKit

/// Narrow native capabilities for the *same* React/MUI PWA UI.
/// There is no SwiftUI login, Gallery, Files or Photos backup page here.
/// Web's in-memory short-lived access token flows one way (Web -> native)
/// only on a verified, explicit operation. Keychain/refresh secrets NEVER
/// flow into JavaScript and WebKit cookies are never copied into URLSession.
final class XDriveIOSPhotoHostBridge: NSObject, WKScriptMessageHandler {
    static let messageName = "xdriveIOSHost"

    weak var webView: WKWebView?
    private let origin: URL
    private let onRequestServerChange: () -> Void
    private var activeBackup: Task<Void, Never>?
    private var activeBackupID: String?
    private var activeGrantTask: Task<Void, Never>?
    private var consent: CheckedContinuation<Bool, Never>?
    private weak var consentAlert: UIAlertController?
    private var backgroundObserver: NSObjectProtocol?

    init(origin: URL, onRequestServerChange: @escaping () -> Void) {
        self.origin = origin
        self.onRequestServerChange = onRequestServerChange
        super.init()
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.cancelActive() }
        }
    }

    deinit {
        if let backgroundObserver {
            NotificationCenter.default.removeObserver(backgroundObserver)
        }
    }

    /// Called on WebKit's UI thread. Never trust the body, the declared Owner,
    /// or the URL merely because a Web script can post a message.
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        Task { @MainActor [weak self] in
            await self?.receive(message)
        }
    }

    @MainActor
    private func receive(_ message: WKScriptMessage) async {
        guard message.name == Self.messageName,
              trustedMainFrame(message),
              let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              UUID(uuidString: id) != nil,
              let version = body["version"] as? Int, version == 1,
              let method = body["method"] as? String,
              method.utf8.count <= 64 else {
            return
        }
        await handle(id: id, method: method, body: body)
    }

    @MainActor
    private func trustedMainFrame(_ message: WKScriptMessage) -> Bool {
        guard message.frameInfo.isMainFrame,
              let currentURL = webView?.url,
              sameOrigin(currentURL),
              message.frameInfo.securityOrigin.protocol.lowercased() == "https",
              message.frameInfo.securityOrigin.host.lowercased() == origin.host?.lowercased()
        else { return false }
        let port = message.frameInfo.securityOrigin.port
        // A zero port is WebKit's representation of an implicit default port
        // on some iOS versions; never treat it as a wildcard.
        return (port == 0 && origin.port == nil) || port == (origin.port ?? 443)
    }

    private func sameOrigin(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == origin.host?.lowercased(),
              (url.port ?? 443) == (origin.port ?? 443),
              url.user == nil, url.password == nil
        else { return false }
        return true
    }

    private struct WebOwner {
        let username: String
        let ownerID: UInt64
        let accessToken: String
    }

    private func parseOwner(_ body: [String: Any]) -> WebOwner? {
        guard let params = body["params"] as? [String: Any],
              let username = params["username"] as? String,
              !username.isEmpty, username.utf8.count <= 128,
              let number = params["ownerID"] as? NSNumber,
              number.doubleValue.isFinite,
              number.doubleValue >= 1,
              number.doubleValue <= 9_007_199_254_740_991,
              number.doubleValue.rounded(.towardZero) == number.doubleValue,
              let accessToken = params["accessToken"] as? String,
              !accessToken.isEmpty, accessToken.utf8.count <= 16_384
        else { return nil }
        return WebOwner(username: username, ownerID: number.uint64Value,
                        accessToken: accessToken)
    }

    private func verifiedOwner(_ source: WebOwner) async throws -> XDriveNativeOwnerRoot {
        let owner = try await XDriveNativeOwnerRootVerifier(
            origin: origin,
            accessToken: source.accessToken,
            expectedUsername: source.username
        ).verify()
        guard owner.ownerID == source.ownerID,
              owner.username == source.username,
              owner.origin == origin else {
            throw XDriveNativeOwnerRootFailure.ownerChanged
        }
        return owner
    }

    @MainActor
    private func handle(id: String, method: String, body: [String: Any]) async {
        switch method {
        case "capabilities":
            sendResult(id, [
                "protocolVersion": 1, "platform": "ios",
                "photoKit": true, "foregroundStillBackup": true,
                "scanWindows": true,
                "nativeBackgroundGrant": true,
                // This advertises only secure native consent + Keychain
                // provisioning; actual locked-screen file uploads remain off.
                "nativeBackgroundUpload": false,
                "maxScannedAssets": XDriveIOSForegroundPhotoBackupMVP.maxScannedAssets,
                "maxNewOriginalsPerRun": XDriveIOSForegroundPhotoBackupMVP.maxNewOriginalsPerRun
            ])
        case "host.server.change":
            // Unlike Photos operations this action is available on the
            // *shared PWA login screen*, so it cannot demand an Owner token.
            // Still require the exact origin-locked main frame, and show an
            // explicit native confirmation before stopping that WebView.
            guard activeBackup == nil && activeGrantTask == nil else {
                sendError(id, "照片备份或后台授权正在处理，请先结束后切换服务器。")
                return
            }
            guard let currentURL = webView?.url, sameOrigin(currentURL) else {
                sendError(id, "当前页面来源无法验证，拒绝切换服务器。")
                return
            }
            sendResult(id, ["confirmationRequested": true])
            onRequestServerChange()
        case "photos.status", "photos.requestAccess":
            guard let source = parseOwner(body) else {
                sendError(id, "当前 PWA 会话信息无效，请重新登录。")
                return
            }
            do {
                _ = try await verifiedOwner(source)
                // An asynchronous Owner probe may finish after the old PWA
                // navigated to another host; never show a Photos prompt then.
                guard let currentURL = webView?.url, sameOrigin(currentURL) else {
                    sendError(id, "网页已切换，原生相册操作已停止。")
                    return
                }
                if method == "photos.requestAccess" {
                    guard activeBackup == nil else {
                        sendError(id, "已有一轮备份正在运行，请先完成或取消。")
                        return
                    }
                    // The only OS authorization prompt is driven by an
                    // explicit click in shared React settings, never startup.
                    _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                }
                sendResult(id, photoStatus())
            } catch {
                sendError(id, "无法核实当前服务器与 Owner，未读取系统相册。")
            }
        case "photos.background.grant.status":
            guard let source = parseOwner(body) else {
                sendError(id, "后台授权状态需要当前登录的 Owner。")
                return
            }
            do {
                let owner = try await verifiedOwner(source)
                let manager = XDriveIOSPhotoBackgroundGrantManager.shared
                let local = try await manager.localStatus(owner: owner)
                if local.enabled {
                    do {
                        let server = try await manager.verifyRemote(
                            owner: owner, accessToken: source.accessToken
                        )
                        sendResult(id, backgroundGrantStatusObject(
                            server, serverVerified: true
                        ))
                    } catch {
                        // A network failure, revoked credential or old Server
                        // cannot be represented as active upload permission.
                        sendResult(id, backgroundGrantStatusObject(
                            local, serverVerified: false
                        ))
                    }
                } else {
                    sendResult(id, backgroundGrantStatusObject(
                        local, serverVerified: false
                    ))
                }
            } catch {
                sendError(id, "当前 Owner/Root 或本机后台凭据无法验证。")
            }
        case "photos.background.grant.configure":
            guard activeBackup == nil && activeGrantTask == nil,
                  let source = parseOwner(body),
                  let params = body["params"] as? [String: Any],
                  let enabled = params["enabled"] as? Bool else {
                sendError(id, "后台授权配置无效或已有前台任务正在运行。")
                return
            }
            activeGrantTask = Task { @MainActor [weak self] in
                guard let self else { return }
                defer { self.activeGrantTask = nil }
                do {
                    let owner = try await self.verifiedOwner(source)
                    try Task.checkCancellation()
                    guard let currentURL = self.webView?.url,
                          self.sameOrigin(currentURL) else {
                        self.sendError(id, "当前网页已切换，拒绝修改后台授权。")
                        return
                    }
                    let manager = XDriveIOSPhotoBackgroundGrantManager.shared
                    if enabled {
                        let access = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                        guard access == .authorized || access == .limited else {
                            self.sendError(id, "请先授予 iPhone 相册访问权限。")
                            return
                        }
                        let accepted = await self.confirmBackgroundGrant(owner: owner)
                        try Task.checkCancellation()
                        guard accepted else {
                            self.sendError(id, "未创建后台备份授权。")
                            return
                        }
                        _ = try await manager.enableAfterNativeConfirmation(
                            owner: owner, accessToken: source.accessToken
                        )
                        let verified = try await manager.verifyRemote(
                            owner: owner, accessToken: source.accessToken
                        )
                        try Task.checkCancellation()
                        self.sendResult(id, self.backgroundGrantStatusObject(
                            verified, serverVerified: true
                        ))
                    } else {
                        let stopped = try await manager.disable(
                            owner: owner, accessToken: source.accessToken
                        )
                        self.sendResult(id, self.backgroundGrantStatusObject(
                            stopped, serverVerified: false
                        ))
                    }
                } catch is CancellationError {
                    self.sendError(id, "后台授权操作已取消，未假定成功。")
                } catch {
                    self.sendError(id, enabled
                        ? "无法安全签发或验证后台凭据；请检查设备注册、Owner、服务器和 Keychain。"
                        : "本机后台任务已请求停止；若服务器断线，请恢复后再次撤销远端授权。")
                }
            }
        case "photos.backup.start":
            guard activeBackup == nil && activeGrantTask == nil else {
                sendError(id, "已有一轮照片备份正在运行。")
                return
            }
            guard let source = parseOwner(body),
                  let params = body["params"] as? [String: Any],
                  let allowCloud = params["allowICloudOriginals"] as? Bool else {
                sendError(id, "缺少经过验证的当前账户或备份选项。")
                return
            }
            // Old Web clients omit windowIndex and retain the first-window
            // behavior. New shared Settings only offers window selection after
            // capabilities.scanWindows is reported true by this native host.
            // Reject fractional, Boolean, negative and overflowing indices.
            let requestedWindow: NSNumber
            if let value = params["windowIndex"] {
                guard let number = value as? NSNumber,
                      CFGetTypeID(number) != CFBooleanGetTypeID() else {
                    sendError(id, "相册分段编号无效，未启动备份。")
                    return
                }
                requestedWindow = number
            } else {
                requestedWindow = NSNumber(value: 0)
            }
            let value = requestedWindow.doubleValue
            guard value.isFinite, value >= 0,
                  value <= min(Double(Int.max / XDrivePhotoBackupScanWindow.maxItems),
                               9_007_199_254_740_991),
                  value.rounded(.towardZero) == value,
                  let startOffset = XDrivePhotoBackupScanWindow.offset(
                    for: requestedWindow.intValue
                  ) else {
                sendError(id, "相册分段超出可支持范围，未开始备份。")
                return
            }
            let access = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            guard access == .authorized || access == .limited else {
                sendError(id, "尚未授权访问系统照片，未开始备份。")
                return
            }
            activeBackupID = id
            activeBackup = Task { @MainActor [weak self] in
                guard let self else { return }
                defer {
                    self.activeBackup = nil
                    self.activeBackupID = nil
                }
                do {
                    let owner = try await self.verifiedOwner(source)
                    try Task.checkCancellation()
                    guard let currentURL = self.webView?.url,
                          self.sameOrigin(currentURL) else {
                        self.sendError(id, "网页已切换，原生备份已停止。")
                        return
                    }
                    let accepted = await self.confirmBackup(
                        owner: owner, allowCloud: allowCloud, startOffset: startOffset
                    )
                    try Task.checkCancellation()
                    guard accepted else {
                        self.sendError(id, "用户取消了照片备份，没有启动上传。")
                        return
                    }
                    let report = try await XDriveIOSForegroundPhotoBackupMVP(
                        owner: owner, accessToken: source.accessToken
                    ).run(allowICloudOriginals: allowCloud, startOffset: startOffset) { [weak self] progress in
                        self?.sendProgress(id, progress)
                    }
                    try Task.checkCancellation()
                    self.sendResult(id, self.progressObject(report))
                } catch is CancellationError {
                    // A lost create/finalize ACK remains uncertain in the
                    // sealed ledger; cancellation never reports success.
                    self.sendError(id, "备份已中断。已提交的文件需要 Server 收据核对，不能盲目重试。")
                } catch XDrivePhotoKitScanFailure.snapshotChanged {
                    self.sendError(id, "相册或授权发生变化，本轮扫描已停止。")
                } catch {
                    self.sendError(id, "原件备份停止：请检查 Owner 授权、网络和加密账本；未确认的文件不计成功。")
                }
            }
        case "photos.backup.cancel":
            cancelActive()
            sendResult(id, ["cancelRequested": true])
        default:
            sendError(id, "当前 iOS Host Adapter 不支持该操作。")
        }
    }

    private func backgroundGrantStatusObject(
        _ result: XDriveIOSPhotoBackgroundGrantStatus,
        serverVerified: Bool
    ) -> [String: Any] {
        let expiry = result.expiresAt?.timeIntervalSince1970 ?? 0
        return [
            "enrolled": result.enrolled,
            "enabled": result.enabled && serverVerified,
            "storedButUnverified": result.enabled && !serverVerified,
            "revokePending": result.revokePending,
            "serverVerified": serverVerified,
            "expiresAt": expiry > 0 && expiry < 4_102_444_800
                ? Int64((expiry * 1000).rounded(.towardZero)) : 0,
            "backgroundUploadReady": false
        ]
    }

    @MainActor
    private func confirmBackgroundGrant(
        owner: XDriveNativeOwnerRoot
    ) async -> Bool {
        await withCheckedContinuation { continuation in
            guard let presenter = webView?.window?.rootViewController,
                  presenter.presentedViewController == nil,
                  consent == nil else {
                continuation.resume(returning: false)
                return
            }
            consent = continuation
            let alert = UIAlertController(
                title: "允许这台 iPhone 的受限后台备份授权？",
                message: "当前账户：\(owner.username)\n服务器：\(owner.origin.host ?? "xDrive")\n只允许此设备向当前账户 Root 上传照片、视频和完整 Live 原件。授权有效期最多 14 天、可以随时撤销。\n为兼容锁屏，独立的受限 Device/Grant 证明将以此设备专用、首次解锁后可用的 Keychain 方式保存。\n目前只会在后台核实授权，不会自动上传照片；完整无人值守备份仍在实现中。",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in
                self?.finishConsent(false)
            })
            alert.addAction(UIAlertAction(title: "同意授权", style: .default) { [weak self] _ in
                self?.finishConsent(true)
            })
            consentAlert = alert
            presenter.present(alert, animated: true)
        }
    }

    @MainActor
    private func photoStatus() -> [String: Any] {
        let authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        let name: String
        switch authorization {
        case .authorized: name = "authorized"
        case .limited: name = "limited"
        case .notDetermined: name = "notDetermined"
        case .denied: name = "denied"
        case .restricted: name = "restricted"
        @unknown default: name = "restricted"
        }
        var result: [String: Any] = ["authorization": name]
        if authorization == .authorized || authorization == .limited {
            // Lazy PHFetchResult count only; no raw PhotoKit IDs, metadata,
            // thumbnails, GPS or originals cross the JavaScript bridge.
            result["totalVisible"] = PHAsset.fetchAssets(with: nil).count
        }
        return result
    }

    private func progressObject(_ progress: XDriveIOSPhotoBackupProgress) -> [String: Any] {
        [
            "totalVisible": progress.totalVisible,
            "startOffset": progress.startOffset,
            "scanned": progress.scanned,
            "uploaded": progress.uploaded,
            "verifiedAlready": progress.verifiedAlready,
            "liveNotSupported": progress.liveNotSupported,
            "videosNotSupported": progress.videosNotSupported,
            "unavailable": progress.unavailable,
            "needsReview": progress.needsReview,
            "isLimited": progress.isLimited,
            "stoppedForReview": progress.stoppedForReview,
            "stage": progress.stage
        ]
    }

    @MainActor
    private func confirmBackup(owner: XDriveNativeOwnerRoot,
                               allowCloud: Bool, startOffset: Int) async -> Bool {
        await withCheckedContinuation { continuation in
            guard let presenter = webView?.window?.rootViewController,
                  presenter.presentedViewController == nil,
                  consent == nil else {
                continuation.resume(returning: false)
                return
            }
            consent = continuation
            let alert = UIAlertController(
                title: "开始 iPhone 相册备份？",
                message: "将当前已授权相册第 \(startOffset + 1) 项起、最多 256 项中的普通照片原件上传到 \(owner.origin.host ?? "xDrive") 的 \(owner.username) 云端文件，每轮最多新增 20 张。Live Photo 和视频不会标记完成。\n\(allowCloud ? "允许下载 iCloud 原件。" : "不下载 iCloud 原件。")",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in
                self?.finishConsent(false)
            })
            alert.addAction(UIAlertAction(title: "开始备份", style: .default) { [weak self] _ in
                self?.finishConsent(true)
            })
            consentAlert = alert
            presenter.present(alert, animated: true)
        }
    }

    @MainActor
    private func finishConsent(_ accepted: Bool) {
        guard let pending = consent else { return }
        consent = nil
        consentAlert?.dismiss(animated: false)
        consentAlert = nil
        pending.resume(returning: accepted)
    }

    /// Called on WebView teardown, navigation or iOS background, as well as
    /// from the shared React Cancel control. No detached backup task survives.
    func cancelActive() {
        activeBackup?.cancel()
        activeGrantTask?.cancel()
        if consent != nil {
            // Both WebKit and UIApplication lifecycle callbacks run on main.
            Task { @MainActor [weak self] in self?.finishConsent(false) }
        }
    }

    @MainActor
    private func sendProgress(_ id: String, _ report: XDriveIOSPhotoBackupProgress) {
        guard activeBackupID == id else { return }
        dispatch(name: "xdrive-ios-host-progress",
                 payload: ["id": id, "data": progressObject(report)])
    }

    @MainActor
    private func sendResult(_ id: String, _ value: [String: Any]) {
        dispatch(name: "xdrive-ios-host-response",
                 payload: ["id": id, "ok": true, "data": value])
    }

    @MainActor
    private func sendError(_ id: String, _ message: String) {
        dispatch(name: "xdrive-ios-host-response",
                 payload: ["id": id, "ok": false, "error": message])
    }

    @MainActor
    private func dispatch(name: String, payload: [String: Any]) {
        guard let webView, let url = webView.url, sameOrigin(url) else { return }
        let script = "window.dispatchEvent(new CustomEvent('\(name)', {detail: payload}));"
        // Pass structured JSON arguments directly, never interpolate bearer
        // credentials or untrusted filenames into JavaScript source.
        webView.callAsyncJavaScript(script, arguments: ["payload": payload],
                                    in: nil, in: .page, completionHandler: nil)
    }
}
