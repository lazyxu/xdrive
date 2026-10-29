import Foundation

/// Explicit one-photo upload to the currently authenticated cloud root.
/// This is not PhotoKit SourceRun, PhotoAsset pairing or auto-sync.
enum XDriveIOSManualPhotoUploadFailure: Error {
    case ownerNotVerified
    case ownerChanged
    case originalUnavailable
    case livePairNotSupported
    case videoNotSupported
    case stagingUnexpected
}

/// The only bridge between PhotoKit's private bytes and the existing xDrive
/// Server UploadSession for an explicitly selected *non-Live still photo*.
/// No Device/Source grant or background scheduling is inferred.
struct XDriveIOSManualPhotoOriginalUpload {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    func upload(localIdentifier: String, allowICloudOriginal: Bool) async throws
        -> XDriveNativeUploadReceipt {
        guard !accessToken.isEmpty, owner.ownerID > 0, owner.rootNodeID > 0 else {
            throw XDriveIOSManualPhotoUploadFailure.ownerNotVerified
        }
        try Task.checkCancellation()

        // Inspect only the currently allowed PhotoKit resource metadata.
        // A still+motion Live Photo must NOT be silently backed up as still.
        guard let evidence = XDrivePhotoKitResourceInspector.inspect(
            localIdentifier: localIdentifier
        ) else {
            throw XDriveIOSManualPhotoUploadFailure.originalUnavailable
        }
        if evidence.isLive {
            throw XDriveIOSManualPhotoUploadFailure.livePairNotSupported
        }
        if evidence.isVideo {
            throw XDriveIOSManualPhotoUploadFailure.videoNotSupported
        }
        guard evidence.originalResourceManifestComplete else {
            throw XDriveIOSManualPhotoUploadFailure.originalUnavailable
        }

        // Verify Owner before any (potentially iCloud-networked) export.
        let first = try await XDriveNativeOwnerRootVerifier(
            origin: owner.origin, accessToken: accessToken,
            expectedUsername: owner.username
        ).verify()
        guard sameScope(first) else {
            throw XDriveIOSManualPhotoUploadFailure.ownerChanged
        }
        try Task.checkCancellation()

        // Explicit user opt-in is the only way to permit downloading an
        // evicted original from iCloud. Stage at most 128 MiB, with complete
        // iOS file protection and caller-owned deletion in all outcomes.
        let staged = try await XDrivePhotoKitOriginalExporter.stage(
            localIdentifier: localIdentifier,
            allowICloudDownload: allowICloudOriginal,
            maximumBytesPerResource: 128 * 1_048_576
        )
        defer { staged.delete() }
        guard staged.kind == "image", staged.resources.count == 1,
              let still = staged.resources.first, still.role == "still",
              still.byteCount > 0, still.byteCount <= 128 * 1_048_576 else {
            throw XDriveIOSManualPhotoUploadFailure.stagingUnexpected
        }
        try Task.checkCancellation()

        // Permission and cloud identity may have changed while an iCloud
        // original was fetched. Never use a stale destination/Owner.
        guard let current = XDrivePhotoKitResourceInspector.inspect(
            localIdentifier: localIdentifier
        ), !current.isLive, !current.isVideo,
              current.originalResourceManifestComplete else {
            throw XDriveIOSManualPhotoUploadFailure.originalUnavailable
        }
        let latest = try await XDriveNativeOwnerRootVerifier(
            origin: owner.origin, accessToken: accessToken,
            expectedUsername: owner.username
        ).verify()
        guard sameScope(latest) else {
            throw XDriveIOSManualPhotoUploadFailure.ownerChanged
        }
        try Task.checkCancellation()

        // Existing one-shot manual upload is intentionally NOT promoted to a
        // durable device Push receipt. The UI warns about uncertain create
        // or finalize ACK and never silently submits a new operation.
        let transport = try XDriveNativeUploadSessionTransport(
            origin: latest.origin, accessToken: accessToken
        )
        return try await transport.uploadOnce(
            from: still.fileURL,
            name: still.originalFilename,
            parentID: latest.rootNodeID
        )
    }

    private func sameScope(_ candidate: XDriveNativeOwnerRoot) -> Bool {
        candidate.origin == owner.origin &&
        candidate.instanceID == owner.instanceID &&
        candidate.ownerID == owner.ownerID &&
        candidate.rootNodeID == owner.rootNodeID &&
        candidate.username == owner.username
    }
}
