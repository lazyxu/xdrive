import Foundation
import Photos

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
    let accessToken: String

    /// One deliberate foreground click; bounded work for a usable first
    /// milestone. Never silently claim the remainder of an album is backed up.
    static let maxScannedAssets = XDrivePhotoBackupScanWindow.maxItems
    static let maxNewOriginalsPerRun = 20

    func run(allowICloudOriginals: Bool, startOffset: Int = 0,
             onProgress: @MainActor @escaping (XDriveIOSPhotoBackupProgress) -> Void)
        async throws -> XDriveIOSPhotoBackupProgress {
        guard startOffset >= 0, !accessToken.isEmpty, owner.ownerID > 0,
              owner.rootNodeID > 0, !owner.instanceID.isEmpty else {
            throw XDriveIOSPhotoBackupMVPError.identityNotVerified
        }
        let latest = try await XDriveNativeOwnerRootVerifier(
            origin: owner.origin, accessToken: accessToken,
            expectedUsername: owner.username
        ).verify()
        guard latest.origin == owner.origin,
              latest.ownerID == owner.ownerID,
              latest.rootNodeID == owner.rootNodeID,
              latest.instanceID == owner.instanceID else {
            throw XDriveIOSPhotoBackupMVPError.identityNotVerified
        }
        // An expired BGTask, navigation or Owner switch may cancel the job
        // while the HTTPS verifier is awaiting the Server. Check again
        // before even starting a potentially expensive PhotoKit snapshot.
        try Task.checkCancellation()

        let scanner = XDrivePhotoKitBoundedSnapshotScanner()
        var report = XDriveIOSPhotoBackupProgress()
        report.startOffset = startOffset
        report.stage = "检查当前授权相册…"
        await onProgress(report)

        do {
            report.totalVisible = try await scanner.start(atOffset: startOffset)
            report.isLimited = await currentLimitedAuthorization()
            let windowCapacity = XDrivePhotoBackupScanWindow.capacity(
                visibleTotal: report.totalVisible, offset: startOffset
            )
            await onProgress(report)

            scanning: while report.scanned < windowCapacity &&
                    !report.stoppedForReview &&
                    report.uploaded < Self.maxNewOriginalsPerRun {
                try Task.checkCancellation()
                let page = try await scanner.nextPage()
                for candidate in page.items {
                    try Task.checkCancellation()
                    if report.scanned >= windowCapacity ||
                       report.uploaded >= Self.maxNewOriginalsPerRun {
                        break scanning
                    }
                    report.scanned += 1
                    // Live uses one atomic ZIP Node containing both originals.
                    // Never run it through the still-only resource path.
                    guard candidate.isLive && candidate.kind == "image" ||
                        XDriveIOSOriginalBackupMediaPolicy.eligible(
                            kind: candidate.kind, isLive: candidate.isLive
                        ) else {
                        report.videosNotSupported += 1
                        report.stage = "无法识别的媒体类型，已跳过"
                        await onProgress(report)
                        continue
                    }
                    let isVideo = candidate.kind == "video"
                    let isLive = candidate.isLive
                    report.stage = "正在核对并备份已授权的照片/视频/Live 原件（\(report.scanned)/\(windowCapacity)）…"
                    await onProgress(report)
                    do {
                        let outcome = try await uploadOrVerifyOriginal(
                            candidate.id, isVideo: isVideo, isLive: isLive,
                            allowICloud: allowICloudOriginals
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
                        // A missing iCloud original, incompatible filename or
                        // access loss must never appear in the confirmed count.
                        // Unknown Server intent is detected and paused by the
                        // per-resource journal readback in uploadOrVerifyStill.
                        report.unavailable += 1
                        report.stage = "有照片原件无法确认，请查看备份汇总"
                    }
                    await onProgress(report)
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
            await onProgress(report)
            return report
        } catch {
            await scanner.reset()
            throw error
        }
    }

    private enum StillOutcome {
        case uploaded, alreadyConfirmed, requiresReview
    }

    private func uploadOrVerifyOriginal(
        _ localIdentifier: String, isVideo: Bool, isLive: Bool,
        allowICloud: Bool
    ) async throws -> StillOutcome {
        // This stable Keychain namespace is used ONLY for user-initiated
        // Owner Files. It is not a registered Server Device and never grants
        // desktop local_folder/PhotoAsset Source execution.
        let binding = try await XDriveIOSForegroundBackupIdentity.shared
            .localScopeAndTag(owner: owner, localIdentifier: localIdentifier)
        try Task.checkCancellation()
        let staged = try await XDrivePhotoKitOriginalExporter.stage(
            localIdentifier: localIdentifier,
            allowICloudDownload: allowICloud,
            // Larger uncompressed originals are handled as bounded 8-MiB
            // UploadSession chunks. Disk staging is still one resource at a time.
            maximumBytesPerResource: isLive
                ? XDriveIOSLiveOriginalArchive.maximumPartBytes
                : isVideo ? XDriveIOSOriginalBackupMediaPolicy.videoLimit
                  : XDriveIOSOriginalBackupMediaPolicy.stillLimit
        )
        defer { staged.delete() }
        try Task.checkCancellation()

        let journal = XDrivePhotoSyncLedger.shared
        let preparer = XDriveIOSPhotoKitStagedIntentPreparer(
            owner: owner, scope: binding.scope,
            accessToken: accessToken, ledger: journal
        )
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
                try await XDriveIOSNodeReceiptReadbackVerifier(
                    owner: owner, accessToken: accessToken
                ).verify(
                    XDriveNativeUploadReceipt(
                        nodeID: nodeID,
                        nodeName: prepared.destinationName,
                        revision: revision,
                        sha256: prepared.sha256,
                        bytes: prepared.byteSize,
                        sessionID: sessionID
                    ),
                    parentID: prepared.destinationParentID,
                    expectedName: prepared.destinationName
                )
                return .alreadyConfirmed
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // A file may have been modified/deleted in the cloud.
                // Do not silently resend into a conflict or erase history.
                return .requiresReview
            }
        case .prepared:
            do {
                _ = try await XDriveIOSJournaledOriginalUpload(
                    owner: owner, scope: binding.scope,
                    accessToken: accessToken, ledger: journal
                ).uploadPrepared(prepared, from: uploadFile)
                return .uploaded
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                let after = try? await journal.operations(scope: binding.scope)
                if let current = after?.first(where: { $0.id == prepared.id }),
                   current.state != .prepared {
                    return .requiresReview
                }
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
