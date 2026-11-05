import Foundation
import Photos
import UIKit

/// Real Owner Files original backup of stills and videos; Live pairs require
/// a separate authoritative dual-resource pairing receipt before completion.
/// Each source is SHA-256 checked against a sealed intent and finalized
/// Go UploadSession/Owner Node. Never call this from a background scanner.
struct XDriveIOSPhotoBackupProgress: Equatable {
    var totalVisible = 0
    var startOffset = 0
    var scanned = 0
    var uploaded = 0
    var verifiedAlready = 0
    var videoUploaded = 0
    var videoVerifiedAlready = 0
    var liveBundleUploaded = 0
    var liveBundleVerifiedAlready = 0
    var liveNotSupported = 0
    var videosNotSupported = 0
    var unavailable = 0
    var skippedBeforeBaseline = 0
    // Persistent PhotoKit queue work is reported separately from the 256-slot
    // positional scan so it cannot corrupt the auto-window cursor arithmetic.
    var changeQueueProcessed = 0
    var changeQueueUploaded = 0
    var changeQueueVerified = 0
    var changeQueueFailed = 0
    // Bounded in-memory reasons for THIS window, not a persistent retry queue.
    var issues = XDriveIOSPhotoBackupIssueSummary()
    var needsReview = 0
    var isLimited = false
    var stoppedForReview = false
    var stage = "尚未开始"

    var verifiedTotal: Int { uploaded + verifiedAlready }
}

enum XDriveIOSPhotoBackupMVPError: Error {
    case identityNotVerified
    case unavailableSource
}

struct XDriveIOSForegroundPhotoBackupMVP {
    let owner: XDriveNativeOwnerRoot
    private let authorization: XDriveIOSOriginalOwnerAuthorization
    private let sourceProgress: @MainActor (XDriveIOSPhotoBackupProgress) -> Void

    init(owner: XDriveNativeOwnerRoot, accessToken: String) {
        self.owner = owner
        self.authorization = .webBearer(accessToken)
        self.sourceProgress = { _ in }
    }

    init(owner: XDriveNativeOwnerRoot,
         managedForeground: XDriveIOSManagedOriginalAuthority,
         onSourceProgress: @escaping @MainActor (XDriveIOSPhotoBackupProgress) -> Void = { _ in }) {
        self.owner = owner
        self.authorization = .managedForeground(managedForeground)
        self.sourceProgress = onSourceProgress
    }

    init(owner: XDriveNativeOwnerRoot,
         approvedBackgroundGrant: XDriveIOSApprovedPhotoBGCredential) {
        self.owner = owner
        self.authorization = .background(approvedBackgroundGrant)
        self.sourceProgress = { _ in }
    }

    /// One deliberate foreground click; bounded work for a usable first
    /// milestone. Never silently claim the remainder of an album is backed up.
    static let maxScannedAssets = XDrivePhotoBackupScanWindow.maxItems
    static let maxNewOriginalsPerRun = 20

    func run(allowICloudOriginals: Bool, startOffset: Int = 0,
             maximumNewOriginals: Int = Self.maxNewOriginalsPerRun,
             newOnlySince: Date? = nil,
             changeQueue: XDriveIOSPhotoKitPersistentBackupQueue? = nil,
             onPotentialWrite: @MainActor @escaping () -> Void = {},
             onProgress: @MainActor @escaping (XDriveIOSPhotoBackupProgress) -> Void)
        async throws -> XDriveIOSPhotoBackupProgress {
        func publish(_ value: XDriveIOSPhotoBackupProgress) async {
            await onProgress(value)
            await sourceProgress(value)
        }
        guard startOffset >= 0, maximumNewOriginals > 0,
              maximumNewOriginals <= Self.maxNewOriginalsPerRun,
              owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty,
              (newOnlySince?.timeIntervalSince1970.isFinite ?? true)
        else {
            throw XDriveIOSPhotoBackupMVPError.identityNotVerified
        }
        // BGTasks may be admitted after suspension. Legacy journal keys and
        // original staging files are WhenUnlocked/FileProtection.complete.
        // Do NOT lower file/key protection or read PHAssets while locked.
        if case .background = authorization {
            guard UIApplication.shared.isProtectedDataAvailable else {
                throw XDriveIOSPhotoBackupMVPError.unavailableSource
            }
        }
        try await authorization.verify(owner: owner)
        try Task.checkCancellation()

        let scanner = XDrivePhotoKitBoundedSnapshotScanner()
        var report = XDriveIOSPhotoBackupProgress()
        report.startOffset = startOffset
        report.stage = "检查当前授权相册…"
        await publish(report)

        do {
            report.totalVisible = try await scanner.start(
                atOffset: startOffset, requireStableResume: true
            )
            report.isLimited = await currentLimitedAuthorization()
            let windowCapacity = XDrivePhotoBackupScanWindow.capacity(
                visibleTotal: report.totalVisible, offset: startOffset
            )
            await publish(report)

            // New/edited assets captured by PhotoKit since the explicit
            // only-new baseline are consumed before the older positional
            // catch-up window. The queue supplies IDs only; every original
            // still passes the exact existing Owner/Device/CAS/receipt writer.
            var queuedIdentifiers = Set<String>()
            if let changeQueue {
                let queued = try await changeQueue.pendingCandidates(
                    owner: owner, limit: 64
                )
                for candidate in queued {
                    try Task.checkCancellation()
                    queuedIdentifiers.insert(candidate.pending.localIdentifier)
                    if report.uploaded >= maximumNewOriginals { break }
                    report.changeQueueProcessed += 1
                    report.stage = "优先处理新增/修改的原件（队列 \(report.changeQueueProcessed)）…"
                    await publish(report)

                    guard candidate.kind == "image" || candidate.kind == "video",
                          candidate.kind != "unsupported",
                          !candidate.isLive || candidate.kind == "image" else {
                        report.changeQueueFailed += 1
                        report.videosNotSupported += 1
                        report.stage = "变更队列中存在不支持的媒体类型"
                        _ = try await changeQueue.settle(
                            candidate.pending, result: .failed, owner: owner
                        )
                        await publish(report)
                        continue
                    }

                    do {
                        let outcome = try await uploadOrVerifyOriginal(
                            candidate.pending.localIdentifier,
                            isVideo: candidate.kind == "video",
                            isLive: candidate.isLive,
                            allowICloud: allowICloudOriginals,
                            onPotentialWrite: onPotentialWrite
                        )
                        switch outcome {
                        case .uploaded:
                            report.uploaded += 1
                            report.changeQueueUploaded += 1
                            if candidate.kind == "video" { report.videoUploaded += 1 }
                            if candidate.isLive { report.liveBundleUploaded += 1 }
                        case .alreadyConfirmed:
                            report.verifiedAlready += 1
                            report.changeQueueVerified += 1
                            if candidate.kind == "video" { report.videoVerifiedAlready += 1 }
                            if candidate.isLive { report.liveBundleVerifiedAlready += 1 }
                        case .requiresReview:
                            report.needsReview += 1
                            report.stoppedForReview = true
                            report.stage = "新增/修改原件的上传结果待核对，已暂停"
                        }
                        if !report.stoppedForReview {
                            // A newer edit may have advanced this asset's
                            // queue revision while the original was staged.
                            // CAS then leaves that newer revision pending.
                            _ = try await changeQueue.settle(
                                candidate.pending, result: .confirmed, owner: owner
                            )
                        }
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        if Self.isTransientConfirmedReadbackFailure(error) ||
                           Self.mustAbortRun(after: error) { throw error }
                        report.changeQueueFailed += 1
                        report.unavailable += 1
                        report.stage = "有新增/修改原件暂不可用，已保留失败状态"
                        // This path is item-local and the shared writer has
                        // proven no ambiguous Server mutation. Global errors
                        // and unknown ACKs abort above and remain unresolved.
                        _ = try await changeQueue.settle(
                            candidate.pending, result: .failed, owner: owner
                        )
                    }
                    await publish(report)
                    if report.stoppedForReview { break }
                }
            }

            scanning: while report.scanned < windowCapacity &&
                    !report.stoppedForReview &&
                    report.uploaded < maximumNewOriginals {
                try Task.checkCancellation()
                let page = try await scanner.nextPage()
                for candidate in page.items {
                    try Task.checkCancellation()
                    if report.scanned >= windowCapacity ||
                       report.uploaded >= maximumNewOriginals {
                        break scanning
                    }
                    report.scanned += 1
                    if queuedIdentifiers.contains(candidate.id) {
                        // Already handled by the priority queue in this run.
                        // Count the positional slot but never upload it twice.
                        continue
                    }
                    if let newOnlySince {
                        switch XDriveIOSPhotoAutoSchedulePolicy.newOnlyCandidate(
                            capturedAt: candidate.capturedAt,
                            modifiedAt: candidate.modifiedAt,
                            since: newOnlySince
                        ) {
                        case .eligible:
                            break
                        case .olderThanStart:
                            report.skippedBeforeBaseline += 1
                            report.stage = "旧照片未在启用后修改，按仅备份新照片规则跳过"
                            await publish(report)
                            continue
                        case .unknownDates:
                            report.unavailable += 1
                            report.issues.append(
                                position: startOffset + report.scanned,
                                mediaKind: candidate.kind, reason: .unavailable
                            )
                            report.stage = "照片日期不可判定；未当作新照片或已备份"
                            await publish(report)
                            continue
                        }
                    }
                    // Live uses one atomic ZIP Node containing both originals.
                    // Never run it through the still-only resource path.
                    guard candidate.isLive && candidate.kind == "image" ||
                        XDriveIOSOriginalBackupMediaPolicy.eligible(
                            kind: candidate.kind, isLive: candidate.isLive
                        ) else {
                        report.videosNotSupported += 1
                        report.issues.append(
                            position: startOffset + report.scanned,
                            mediaKind: candidate.kind, reason: .unsupported
                        )
                        report.stage = "无法识别的媒体类型，已跳过"
                        await publish(report)
                        continue
                    }
                    let isVideo = candidate.kind == "video"
                    let isLive = candidate.isLive
                    report.stage = "正在核对并备份已授权的照片/视频/Live 原件（\(report.scanned)/\(windowCapacity)）…"
                    await publish(report)
                    do {
                        let outcome = try await uploadOrVerifyOriginal(
                            candidate.id, isVideo: isVideo, isLive: isLive,
                            allowICloud: allowICloudOriginals,
                            onPotentialWrite: onPotentialWrite
                        )
                        switch outcome {
                        case .uploaded:
                            report.uploaded += 1
                            if isVideo { report.videoUploaded += 1 }
                            if isLive { report.liveBundleUploaded += 1 }
                        case .alreadyConfirmed:
                            report.verifiedAlready += 1
                            if isVideo { report.videoVerifiedAlready += 1 }
                            if isLive { report.liveBundleVerifiedAlready += 1 }
                        case .requiresReview:
                            report.needsReview += 1
                            report.stoppedForReview = true
                            report.stage = "存在上传结果待核对的文件，已暂停，避免重复上传"
                        }
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        // Owner/root revocation, sealed-ledger corruption or
                        // Photos permission loss invalidates this WHOLE run.
                        // Counting these as a single unavailable original
                        // would continue into other assets and conceal failure.
                        // A temporary read-only check of an ALREADY
                        // confirmed Node is not proof of an unknown write.
                        // Stop this window; do not mark its other 255 assets
                        // unavailable or advance the automatic cursor.
                        if Self.isTransientConfirmedReadbackFailure(error) ||
                           Self.mustAbortRun(after: error) { throw error }
                        // Missing/oversized iCloud or incompatible originals
                        // remain local per-item failures, never confirmed.
                        // Unknown Server ACK remains a distinct review pause.
                        report.unavailable += 1
                        report.issues.append(
                            position: startOffset + report.scanned,
                            mediaKind: isLive ? "live" : candidate.kind,
                            reason: Self.issueReason(after: error)
                        )
                        report.stage = "有照片原件无法确认，请查看备份汇总"
                    }
                    await publish(report)
                    if report.stoppedForReview { break scanning }
                }
                if page.finished { break }
            }

            try Task.checkCancellation()
            if !report.stoppedForReview {
                if windowCapacity == 0 {
                    report.stage = "选定分段没有已授权照片，请选择前一段或重新检查授权"
                } else {
                    report.stage = report.scanned >= windowCapacity
                        ? "当前分段已检查：照片/视频已验证，Live 为双原件 ZIP 单节点归档"
                        : "本轮上传上限已达到，可继续检查该段其他照片与视频"
                }
            }
            await scanner.reset()
            await publish(report)
            return report
        } catch {
            await scanner.reset()
            throw error
        }
    }

    /// Only ITEM-LOCAL errors are summarized. Network, authorization,
    /// device storage, sealed journal and ambiguous ACK failures already
    /// abort/pause above and must never appear as a retryable photo issue.
    private static func issueReason(after error: Error) -> XDriveIOSPhotoBackupIssueReason {
        if let source = error as? XDrivePhotoKitExportFailure {
            switch source {
            case .assetNotVisible: return .notVisible
            case .originalResourceMissing: return .originalMissing
            case .incompleteLivePair: return .incompleteLivePair
            case .resourceTooLarge: return .resourceTooLarge
            case .notAuthorized, .storageUnavailable: return .unavailable
            }
        }
        if let intent = error as? XDriveIOSPhotoIntentPreparationError {
            if case .resourceChangedDuringHash = intent { return .sourceChanged }
        }
        return .unavailable
    }

    /// A global authorization/receipt trust loss must not be reclassified
    /// as one unavailable PhotoKit original and scanned past.
    private static func mustAbortRun(after error: Error) -> Bool {
        // Network outages are not "one inaccessible photo". Advancing a
        // completed 256-slot cursor after repeated offline failures can
        // strand entire older windows until a future full-library wrap.
        // A disk staging failure is equally global, not a missing original.
        if error is URLError ||
           error is XDriveNativeOwnerRootFailure ||
           error is XDrivePhotoSyncLedgerError ||
           error is XDriveIOSPhotoBGVaultFailure {
            // An expired/revoked BG Device grant invalidates this whole run.
            // It must never be classified as one unavailable PhotoKit item.
            return true
        }
        if let source = error as? XDrivePhotoKitExportFailure,
           case .notAuthorized = source {
            return true
        }
        if let source = error as? XDrivePhotoKitExportFailure,
           case .storageUnavailable = source {
            return true
        }
        if let intent = error as? XDriveIOSPhotoIntentPreparationError,
           case .unverifiedOwnerOrDeviceScope = intent {
            return true
        }
        if let intent = error as? XDriveIOSPhotoIntentPreparationError,
           case .stagedStorageUnavailable = intent {
            return true
        }
        if let archive = error as? XDriveIOSLiveArchiveFailure,
           case .storageUnavailable = archive {
            return true
        }
        return false
    }

    /// Only transient READ failures are retryable. In particular 401/403,
    /// 404/410, an inconsistent SHA/revision, or missing ledger evidence are
    /// not converted into a confirmed skip or an automatic upload retry.
    private static func isTransientConfirmedReadbackFailure(_ error: Error) -> Bool {
        if error is URLError { return true }
        if let grant = error as? XDriveIOSPhotoBGVaultFailure,
           case .transientServerStatus(let code) = grant {
            return code == 408 || code == 429 || (500...599).contains(code)
        }
        if let readback = error as? XDriveIOSNodeReceiptReadbackError,
           case .serverRejected(let code) = readback {
            return code == 408 || code == 429 || (500...599).contains(code)
        }
        if let owner = error as? XDriveNativeOwnerRootFailure,
           case .serverStatus(let code) = owner {
            return code == 408 || code == 429 || (500...599).contains(code)
        }
        return false
    }

    private enum StillOutcome {
        case uploaded, alreadyConfirmed, requiresReview
    }

    private func uploadOrVerifyOriginal(
        _ localIdentifier: String, isVideo: Bool, isLive: Bool,
        allowICloud: Bool,
        onPotentialWrite: @MainActor @escaping () -> Void
    ) async throws -> StillOutcome {
        // This stable Keychain namespace is used ONLY for user-initiated
        // Owner Files. It is not a registered Server Device and never grants
        // desktop local_folder/PhotoAsset Source execution.
        try await authorization.verify(owner: owner)
        try Task.checkCancellation()
        let binding = try await XDriveIOSForegroundBackupIdentity.shared
            .localScopeAndTag(owner: owner, localIdentifier: localIdentifier)
        try Task.checkCancellation()
        // The approved BGProcessing writer keeps the legacy 1 GiB video
        // bound; only an active, JWT-authorized foreground run can export
        // and stage a video up to 4 GiB. Live remains a separate ZIP bound.
        let videoMaxBytes: Int64
        if case .background = authorization {
            videoMaxBytes = XDriveIOSOriginalBackupMediaPolicy.backgroundVideoLimit
        } else {
            videoMaxBytes = XDriveIOSOriginalBackupMediaPolicy.videoLimit
        }
        let staged = try await XDrivePhotoKitOriginalExporter.stage(
            localIdentifier: localIdentifier,
            allowICloudDownload: allowICloud,
            // Larger uncompressed originals are handled as bounded 8-MiB
            // UploadSession chunks. Disk staging is still one resource at a time.
            maximumBytesPerResource: isLive
                ? XDriveIOSLiveOriginalArchive.maximumPartBytes
                : isVideo ? videoMaxBytes
                  : XDriveIOSOriginalBackupMediaPolicy.stillLimit
        )
        defer { staged.delete() }
        try Task.checkCancellation()

        let journal = XDrivePhotoSyncLedger.shared
        let preparer: XDriveIOSPhotoKitStagedIntentPreparer
        switch authorization {
        case .webBearer(let token):
            preparer = XDriveIOSPhotoKitStagedIntentPreparer(
                owner: owner, scope: binding.scope,
                accessToken: token, ledger: journal
            )
        case .managedForeground(let authority):
            preparer = XDriveIOSPhotoKitStagedIntentPreparer(
                owner: owner, scope: binding.scope,
                managedForeground: authority, ledger: journal
            )
        case .background(let approved):
            preparer = XDriveIOSPhotoKitStagedIntentPreparer(
                owner: owner, scope: binding.scope,
                approvedBackgroundGrant: approved, ledger: journal
            )
        }
        let prepared: XDrivePhotoSyncOperation
        let uploadFile: URL
        if isLive {
            let pair = try await preparer.prepareLiveBundle(
                localIdentifier: localIdentifier,
                staged: staged, destinationTag: binding.tag
            )
            prepared = pair.operation
            uploadFile = pair.fileURL
        } else if isVideo {
            prepared = try await preparer.prepareVideo(
                localIdentifier: localIdentifier,
                staged: staged, destinationTag: binding.tag
            )
            guard let file = staged.resources.first?.fileURL else {
                throw XDriveIOSPhotoBackupMVPError.unavailableSource
            }
            uploadFile = file
        } else {
            prepared = try await preparer.prepareStill(
                localIdentifier: localIdentifier,
                staged: staged, destinationTag: binding.tag
            )
            guard let file = staged.resources.first?.fileURL else {
                throw XDriveIOSPhotoBackupMVPError.unavailableSource
            }
            uploadFile = file
        }
        try Task.checkCancellation()

        switch prepared.state {
        case .confirmed:
            guard let nodeID = prepared.verifiedNodeID,
                  let revision = prepared.verifiedNodeRevision,
                  let sessionID = prepared.sessionID else {
                return .requiresReview
            }
            // Never skip a photo based only on an old local confirmation.
            // The actual current Owner Node must still have the same digest.
            do {
                try await authorization.verifyNodeReceipt(
                    XDriveNativeUploadReceipt(
                        nodeID: nodeID,
                        nodeName: prepared.destinationName,
                        revision: revision,
                        sha256: prepared.sha256,
                        bytes: prepared.byteSize,
                        sessionID: sessionID
                    ),
                    owner: owner, parentID: prepared.destinationParentID,
                    expectedName: prepared.destinationName
                )
                return .alreadyConfirmed
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // Temporary read errors or a revoked Owner, ledger or
                // background grant invalidate this WHOLE scan window.
                // Never misclassify a revoked identity as an uncertain
                // previously confirmed UploadSession receipt.
                if Self.isTransientConfirmedReadbackFailure(error) ||
                   Self.mustAbortRun(after: error) { throw error }
                // Missing Node, digest/revision mismatch or malformed
                // evidence still require explicit receipt review.
                return .requiresReview
            }
        case .prepared:
            do {
                let writer: XDriveIOSJournaledOriginalUpload
                switch authorization {
                case .webBearer(let token):
                    writer = XDriveIOSJournaledOriginalUpload(
                        owner: owner, scope: binding.scope,
                        accessToken: token, ledger: journal
                    )
                case .managedForeground(let authority):
                    writer = XDriveIOSJournaledOriginalUpload(
                        owner: owner, scope: binding.scope,
                        managedForeground: authority, ledger: journal
                    )
                case .background(let approved):
                    writer = XDriveIOSJournaledOriginalUpload(
                        owner: owner, scope: binding.scope,
                        approvedBackgroundGrant: approved, ledger: journal
                    )
                }
                // Only this exact transition can begin a Server write.
                // Background cancellation before this point is not an
                // uncertain UploadSession ACK and must not poison BG cursors.
                await onPotentialWrite()
                try Task.checkCancellation()
                _ = try await writer.uploadPrepared(prepared, from: uploadFile)
                return .uploaded
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // The transport may have committed an UploadSession while its
                // HTTP ACK was lost. A failed/corrupt readback is NOT proof
                // that the sealed intent is still safely prepared.
                let current: XDrivePhotoSyncOperation?
                do {
                    current = try await journal.operation(
                        scope: binding.scope, id: prepared.id
                    )
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    // Fail closed: stop this whole 256-slot run rather than
                    // treating an unreadable Owner journal as a missing
                    // PhotoKit original and uploading the next candidate.
                    return .requiresReview
                }
                guard let current, current.state == .prepared else {
                    // Missing or potentially committed/confirmed record must
                    // never authorize another new original in this run.
                    return .requiresReview
                }
                // Only a *readable*, authenticated, still-prepared intent
                // proves the failed transport did not start a Server write.
                throw error
            }
        case .creating, .uploading, .finalizing, .needsReconciliation:
            // May already have committed remotely. The future recovery
            // reader must prove its exact HMAC/session/Owner before writes.
            return .requiresReview
        }
    }

    private func currentLimitedAuthorization() async -> Bool {
        // PhotoKit is already gated by scanner.start(); this is metadata only.
        await Task.detached {
            PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited
        }.value
    }
}
