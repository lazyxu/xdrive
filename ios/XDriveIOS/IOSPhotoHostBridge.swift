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
    private var activeReview: Task<Void, Never>?
    private var activeReviewID: String?
    private static let maxReceiptReviewPerRun = 20
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
                "receiptReview": true,
                "foregroundAutoSchedule": true,
                "originalVideo": true,
                "liveOriginalBundle": true,
                "maxScannedAssets": XDriveIOSForegroundPhotoBackupMVP.maxScannedAssets,
                "maxNewOriginalsPerRun": XDriveIOSForegroundPhotoBackupMVP.maxNewOriginalsPerRun
            ])
        case "host.server.change":
            // Unlike Photos operations this action is available on the
            // *shared PWA login screen*, so it cannot demand an Owner token.
            // Still require the exact origin-locked main frame, and show an
            // explicit native confirmation before stopping that WebView.
            guard activeBackup == nil && activeReview == nil else {
                sendError(id, "相册备份或收据核对正在运行，请先完成或取消，再切换服务器。")
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
        case "photos.backup.start":
            guard activeBackup == nil && activeReview == nil else {
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
            guard XDriveIOSPhotoRunGate.shared.acquire() else {
                sendError(id, "已有原生照片/视频任务在运行，请完成或取消后重试。")
                return
            }
            activeBackupID = id
            activeBackup = Task { @MainActor [weak self] in
                guard let self else {
                    XDriveIOSPhotoRunGate.shared.release()
                    return
                }
                defer {
                    self.activeBackup = nil
                    self.activeBackupID = nil
                    XDriveIOSPhotoRunGate.shared.release()
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
        case "photos.auto.status":
            guard let source = parseOwner(body) else {
                sendError(id, "自动备份需要当前有效的共享 Web 登录。")
                return
            }
            do {
                let owner = try await verifiedOwner(source)
                let stored = XDriveIOSPhotoAutoScheduleStore.shared.status(owner: owner)
                if stored?.enabled == true {
                    XDriveIOSBackgroundPhotos.shared.arm(
                        owner: owner, accessToken: source.accessToken
                    )
                }
                sendResult(id, autoStatusObject(stored))
            } catch {
                sendError(id, "无法确认自动备份对应的当前服务器和 Owner。")
            }
        case "photos.auto.configure":
            guard let source = parseOwner(body),
                  let params = body["params"] as? [String: Any],
                  let enabled = params["enabled"] as? Bool else {
                sendError(id, "自动备份设置参数无效。")
                return
            }
            do {
                let owner = try await verifiedOwner(source)
                try Task.checkCancellation()
                guard let currentURL = webView?.url,
                      sameOrigin(currentURL) else {
                    sendError(id, "当前网页已切换，自动备份授权已拒绝。")
                    return
                }
                let store = XDriveIOSPhotoAutoScheduleStore.shared
                if !enabled {
                    store.disable(owner: owner)
                    XDriveIOSBackgroundPhotos.shared.disarm()
                    cancelActive()
                    sendResult(id, autoStatusObject(nil))
                    return
                }
                guard activeBackup == nil, activeReview == nil,
                      let minutes = params["intervalMinutes"] as? Int,
                      let allowCloud = params["allowICloudOriginals"] as? Bool,
                      XDriveIOSPhotoAutoSchedulePolicy.accepts(minutes: minutes),
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else {
                    sendError(id, "请先授权照片、停止当前任务并选择合法备份间隔。")
                    return
                }
                let confirmed = await confirmAutoSchedule(
                    owner: owner, minutes: minutes, allowCloud: allowCloud
                )
                try Task.checkCancellation()
                guard confirmed else {
                    sendError(id, "未开启自动增量备份。")
                    return
                }
                let state = try store.configure(
                    owner: owner, minutes: minutes, allowICloud: allowCloud
                )
                XDriveIOSBackgroundPhotos.shared.arm(
                    owner: owner, accessToken: source.accessToken
                )
                sendResult(id, autoStatusObject(state))
            } catch {
                sendError(id, "自动备份授权或保存失败；不会在未验证的账户上运行。")
            }
        case "photos.auto.disableAllLocal":
            // Explicit emergency OFF is allowed without a live Server token:
            // cancel this device's pending jobs, never widen an upload right.
            let removed = XDriveIOSPhotoAutoScheduleStore.shared.disableAllOnThisDevice()
            XDriveIOSBackgroundPhotos.shared.disarm()
            cancelActive()
            sendResult(id, ["disabledSchedules": removed])
        case "photos.auto.disarm":
            // Logout/unmount revokes only this process's RAM-only BG bearer;
            // Owner-scoped saved preferences remain unchanged.
            XDriveIOSBackgroundPhotos.shared.disarm()
            sendResult(id, ["disarmed": true])
        case "photos.auto.tick":
            guard let source = parseOwner(body) else {
                sendError(id, "前台自动备份需要有效的当前用户。")
                return
            }
            guard activeBackup == nil && activeReview == nil else {
                sendResult(id, ["ran": false, "reason": "busy"])
                return
            }
            var ownsAutoRunGate = false
            do {
                let owner = try await verifiedOwner(source)
                try Task.checkCancellation()
                guard let currentURL = webView?.url,
                      sameOrigin(currentURL),
                      UIApplication.shared.applicationState == .active,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else {
                    sendResult(id, ["ran": false, "reason": "notForegroundOrAuthorized"])
                    return
                }
                XDriveIOSBackgroundPhotos.shared.arm(
                    owner: owner, accessToken: source.accessToken
                )
                guard XDriveIOSPhotoRunGate.shared.acquire() else {
                    sendResult(id, ["ran": false, "reason": "nativeRunBusy"])
                    return
                }
                ownsAutoRunGate = true
                let store = XDriveIOSPhotoAutoScheduleStore.shared
                guard let state = try store.reserveDue(owner: owner),
                      let start = XDrivePhotoBackupScanWindow.offset(
                        for: state.windowIndex
                      ) else {
                    XDriveIOSPhotoRunGate.shared.release()
                    sendResult(id, ["ran": false, "reason": "notDue"])
                    return
                }
                activeBackupID = id
                ownsAutoRunGate = false // transferred to the spawned Task
                activeBackup = Task { @MainActor [weak self] in
                    guard let self else {
                        XDriveIOSPhotoRunGate.shared.release()
                        return
                    }
                    defer {
                        self.activeBackup = nil
                        self.activeBackupID = nil
                        XDriveIOSPhotoRunGate.shared.release()
                    }
                    do {
                        let report = try await XDriveIOSForegroundPhotoBackupMVP(
                            owner: owner, accessToken: source.accessToken
                        ).run(
                            allowICloudOriginals: state.allowICloudOriginals,
                            startOffset: start
                        ) { [weak self] report in
                            self?.sendProgress(id, report)
                        }
                        try Task.checkCancellation()
                        let next = try store.recordResult(
                            owner: owner, progress: report
                        )
                        var answer: [String: Any] = [
                            "ran": true, "uploaded": report.uploaded,
                            "verifiedAlready": report.verifiedAlready,
                            "videoUploaded": report.videoUploaded,
                            "liveBundleUploaded": report.liveBundleUploaded,
                            "needsReview": report.needsReview
                        ]
                        answer["schedule"] = self.autoStatusObject(next)
                        self.sendResult(id, answer)
                    } catch is CancellationError {
                        self.sendError(id, "前台自动备份中断；未完成收据继续保留。")
                    } catch {
                        self.sendError(id, "自动备份发生未确认的原件/网络错误，需在共享设置中复核。")
                    }
                }
            } catch {
                // reserveDue() may have failed before we handed the run gate
                // to an active task. Releasing an unacquired gate is unsafe:
                // only the guarded reserve path owns it.
                if ownsAutoRunGate { XDriveIOSPhotoRunGate.shared.release() }
                sendError(id, "自动备份需要重新核验当前 Owner/Root；未启动上传。")
            }
        case "photos.reconcile.status":
            guard let source = parseOwner(body) else {
                sendError(id, "当前账户凭证无效，无法读取受保护的备份账本。")
                return
            }
            do {
                let owner = try await verifiedOwner(source)
                try Task.checkCancellation()
                let scope = try await XDriveIOSForegroundBackupIdentity.shared
                    .existingLocalScope(owner: owner)
                guard let scope else {
                    sendResult(id, ["pending": 0, "maxPerRun": Self.maxReceiptReviewPerRun])
                    return
                }
                let records = try await XDrivePhotoSyncLedger.shared.operations(scope: scope)
                sendResult(id, [
                    "pending": records.filter { self.needsReceiptReview($0) }.count,
                    "maxPerRun": Self.maxReceiptReviewPerRun
                ])
            } catch {
                sendError(id, "未能核实 Owner 或读取加密账本；未推断任何备份成功。")
            }
        case "photos.reconcile.start":
            guard activeBackup == nil && activeReview == nil,
                  let source = parseOwner(body) else {
                sendError(id, "已有备份/核对正在运行，或当前账户会话无效。")
                return
            }
            guard XDriveIOSPhotoRunGate.shared.acquire() else {
                sendError(id, "另一原生备份/核对任务正在执行。")
                return
            }
            activeReviewID = id
            activeReview = Task { @MainActor [weak self] in
                guard let self else {
                    XDriveIOSPhotoRunGate.shared.release()
                    return
                }
                defer {
                    self.activeReview = nil
                    self.activeReviewID = nil
                    XDriveIOSPhotoRunGate.shared.release()
                }
                do {
                    let owner = try await self.verifiedOwner(source)
                    try Task.checkCancellation()
                    guard let currentURL = self.webView?.url,
                          self.sameOrigin(currentURL) else {
                        self.sendError(id, "网页已切换，收据核对已终止。")
                        return
                    }
                    let scope = try await XDriveIOSForegroundBackupIdentity.shared
                        .existingLocalScope(owner: owner)
                    guard let scope else {
                        self.sendResult(id, [
                            "pending": 0, "checked": 0, "confirmed": 0,
                            "activeUnverified": 0, "missing": 0, "expired": 0,
                            "ambiguous": 0, "stage": "本机没有待核对的旧照片收据"
                        ])
                        return
                    }
                    let ledger = XDrivePhotoSyncLedger.shared
                    let records = try await ledger.operations(scope: scope)
                    let uncertain = records.filter { self.needsReceiptReview($0) }
                    let batch = Array(uncertain.prefix(Self.maxReceiptReviewPerRun))
                    var progress: [String: Any] = [
                        "pending": uncertain.count,
                        "checked": 0,
                        "confirmed": 0,
                        "activeUnverified": 0,
                        "missing": 0,
                        "expired": 0,
                        "ambiguous": 0,
                        "stage": "正在只读核对已存在的 Server 上传会话…"
                    ]
                    self.sendReviewProgress(id, progress)
                    for record in batch {
                        try Task.checkCancellation()
                        let result = try await XDriveIOSPhotoBackupUncertainReceiptRecovery(
                            owner: owner, scope: scope,
                            accessToken: source.accessToken, ledger: ledger
                        ).reconcile(operationID: record.id)
                        try Task.checkCancellation()
                        progress["checked"] = (progress["checked"] as? Int ?? 0) + 1
                        switch result {
                        case .confirmed:
                            progress["confirmed"] = (progress["confirmed"] as? Int ?? 0) + 1
                        case .activeButUnverified:
                            progress["activeUnverified"] = (progress["activeUnverified"] as? Int ?? 0) + 1
                        case .noSessionEvidence:
                            progress["missing"] = (progress["missing"] as? Int ?? 0) + 1
                        case .expiredSession:
                            progress["expired"] = (progress["expired"] as? Int ?? 0) + 1
                        case .ambiguousSession:
                            progress["ambiguous"] = (progress["ambiguous"] as? Int ?? 0) + 1
                        }
                        progress["stage"] = "已核对 \(progress["checked"] as? Int ?? 0)/\(batch.count) 项"
                        self.sendReviewProgress(id, progress)
                    }
                    let latest = try await ledger.operations(scope: scope)
                    try Task.checkCancellation()
                    progress["pending"] = latest.filter { self.needsReceiptReview($0) }.count
                    progress["stage"] = "本轮只读核对已结束；未证实的收据继续保留"
                    self.sendResult(id, progress)
                } catch is CancellationError {
                    self.sendError(id, "核对已取消；未知结果仍保留，不会自动创建新上传。")
                } catch {
                    self.sendError(id, "核对遇到无法验证的 Server/Owner/账本状态，已停止，保留原收据待复核。")
                }
            }
        case "photos.backup.cancel":
            cancelActive()
            sendResult(id, ["cancelRequested": true])
        default:
            sendError(id, "当前 iOS Host Adapter 不支持该操作。")
        }
    }

    private func autoStatusObject(
        _ state: XDriveIOSPhotoAutoScheduleStore.State?
    ) -> [String: Any] {
        [
            "enabled": state?.enabled ?? false,
            "pausedForReview": state?.pausedForReview ?? false,
            "intervalMinutes": state?.intervalMinutes ?? 60,
            "allowICloudOriginals": state?.allowICloudOriginals ?? false,
            "windowIndex": state?.windowIndex ?? 0,
            "nextDueAt": (state?.nextDueAt.timeIntervalSince1970 ?? 0) > 0 &&
                (state?.nextDueAt.timeIntervalSince1970 ?? 0) < 4_102_444_800
                ? Int64(((state?.nextDueAt.timeIntervalSince1970 ?? 0) * 1000)
                    .rounded(.towardZero)) : 0
        ]
    }

    @MainActor
    private func confirmAutoSchedule(
        owner: XDriveNativeOwnerRoot, minutes: Int,
        allowCloud: Bool
    ) async -> Bool {
        await withCheckedContinuation { continuation in
            guard let presenter = webView?.window?.rootViewController,
                  presenter.presentedViewController == nil, consent == nil else {
                continuation.resume(returning: false)
                return
            }
            consent = continuation
            let alert = UIAlertController(
                title: "开启前台自动增量备份？",
                message: "仅当 xDrive App 已打开、共享用户已登录且页面处于前台时，每约 \(minutes) 分钟尝试检查当前授权照片。自动依次扫描分段，每轮最多新增 20 个原件，目标是 \(owner.username) @ \(owner.origin.host ?? "xDrive")。\n离开 App 或锁屏不会保证持续运行。\n\(allowCloud ? "允许按需下载 iCloud 原件。" : "不会下载 iCloud 原件。")",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in
                self?.finishConsent(false)
            })
            alert.addAction(UIAlertAction(title: "启用", style: .default) { [weak self] _ in
                self?.finishConsent(true)
            })
            consentAlert = alert
            presenter.present(alert, animated: true)
        }
    }

    /// Never return an Owner's raw PhotoKit identifiers, destination names,
    /// local HMAC resume keys, original SHA or unverified Node IDs to Web.
    private func needsReceiptReview(_ operation: XDrivePhotoSyncOperation) -> Bool {
        switch operation.state {
        case .creating, .uploading, .finalizing, .needsReconciliation:
            return true
        case .prepared, .confirmed:
            return false
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
            "videoUploaded": progress.videoUploaded,
            "videoVerifiedAlready": progress.videoVerifiedAlready,
            "liveBundleUploaded": progress.liveBundleUploaded,
            "liveBundleVerifiedAlready": progress.liveBundleVerifiedAlready,
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
                message: "将当前已授权相册第 \(startOffset + 1) 项起、最多 256 项中的照片和视频原件上传到 \(owner.origin.host ?? "xDrive") 的 \(owner.username) 云端文件，每轮最多新增 20 项。Live Photo 两份原件以一份可恢复 ZIP 归档；尚不能在图库直接播放。\n\(allowCloud ? "允许下载 iCloud 原件。" : "不下载 iCloud 原件。")",
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
        activeReview?.cancel()
        if consent != nil {
            // Both WebKit and UIApplication lifecycle callbacks run on main.
            Task { @MainActor [weak self] in self?.finishConsent(false) }
        }
    }

    @MainActor
    private func sendReviewProgress(_ id: String, _ report: [String: Any]) {
        guard activeReviewID == id else { return }
        dispatch(name: "xdrive-ios-host-progress",
                 payload: ["id": id, "data": report])
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
