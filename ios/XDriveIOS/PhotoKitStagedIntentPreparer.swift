import CryptoKit
import Foundation
import Photos

enum XDriveIOSPhotoIntentPreparationError: Error {
    case unverifiedOwnerOrDeviceScope
    case originalNotEligible
    case invalidStagedOriginal
    case resourceChangedDuringHash
}

/// Read-only staged bytes -> one sealed Owner/Device photo intent.
/// This does NOT register a device, start a SourceRun, send a network write,
/// upload original bytes or claim a complete backed-up PhotoAsset.
struct XDriveIOSPhotoKitStagedIntentPreparer {
    let owner: XDriveNativeOwnerRoot
    let scope: XDrivePhotoSyncScope
    let accessToken: String
    let ledger: XDrivePhotoSyncLedger

    func prepareStill(localIdentifier: String,
                      staged: XDriveStagedPhotoKitAsset,
                      destinationTag: String? = nil) async throws
        -> XDrivePhotoSyncOperation {
        try await prepareOriginal(
            localIdentifier: localIdentifier, staged: staged,
            destinationTag: destinationTag, role: .still
        )
    }

    /// A real original video is one independently verified Owner File
    /// resource. It is not a Live paired-motion resource or SourceRun.
    func prepareVideo(localIdentifier: String,
                      staged: XDriveStagedPhotoKitAsset,
                      destinationTag: String? = nil) async throws
        -> XDrivePhotoSyncOperation {
        try await prepareOriginal(
            localIdentifier: localIdentifier, staged: staged,
            destinationTag: destinationTag, role: .video
        )
    }

    private func prepareOriginal(localIdentifier: String,
                                 staged: XDriveStagedPhotoKitAsset,
                                 destinationTag: String?,
                                 role: XDrivePhotoSyncResourceRole) async throws
        -> XDrivePhotoSyncOperation {
        guard role == .still || role == .video else {
            throw XDriveIOSPhotoIntentPreparationError.originalNotEligible
        }
        let canonicalOrigin = try ServerAddress.parse(owner.origin.absoluteString)
        // A numeric Owner / stable Server instance is necessary but does not
        // prove that this iPhone owns an authorized PhotoKit Source. An
        // eventually callable Runner must separately establish that proof.
        guard canonicalOrigin == owner.origin, !accessToken.isEmpty,
              owner.ownerID > 0, owner.rootNodeID > 0,
              scope.origin == canonicalOrigin.absoluteString,
              scope.serverInstanceID == owner.instanceID,
              scope.ownerID == owner.ownerID,
              scope.rootNodeID == owner.rootNodeID,
              UUID(uuidString: scope.deviceID) != nil else {
            throw XDriveIOSPhotoIntentPreparationError.unverifiedOwnerOrDeviceScope
        }
        guard !localIdentifier.isEmpty,
              staged.kind == (role == .still ? "image" : "video"),
              staged.resources.count == 1,
              let original = staged.resources.first,
              original.role == (role == .still ? "still" : "video"),
              original.byteCount > 0,
              original.byteCount <= 1_073_741_824,
              validServerFilename(original.originalFilename) else {
            // A Live still must not be independently scheduled without its
            // paired motion original and a Server atomic pair commit.
            throw XDriveIOSPhotoIntentPreparationError.originalNotEligible
        }
        guard original.fileURL.isFileURL, staged.folderURL.isFileURL,
              original.fileURL.standardizedFileURL.deletingLastPathComponent()
                == staged.folderURL.standardizedFileURL else {
            throw XDriveIOSPhotoIntentPreparationError.invalidStagedOriginal
        }
        try Task.checkCancellation()

        let current = try await XDriveNativeOwnerRootVerifier(
            origin: canonicalOrigin, accessToken: accessToken,
            expectedUsername: owner.username
        ).verify()
        guard current.origin == owner.origin,
              current.instanceID == owner.instanceID,
              current.ownerID == owner.ownerID,
              current.rootNodeID == owner.rootNodeID,
              current.username == owner.username else {
            throw XDriveIOSPhotoIntentPreparationError.unverifiedOwnerOrDeviceScope
        }
        let originalStamp = try currentResourceStamp(
            localIdentifier, expectedName: original.originalFilename, role: role
        )
        let fullHash = try hashStagedFile(
            original.fileURL, claimedSize: original.byteCount
        )
        try Task.checkCancellation()

        // PhotoKit's permission and basic source revision evidence must
        // remain stable while reading the staged bytes. A real SourceRun
        // must still reverify asset identity immediately before a write.
        let latestStamp = try currentResourceStamp(
            localIdentifier, expectedName: original.originalFilename, role: role
        )
        guard latestStamp == originalStamp else {
            throw XDriveIOSPhotoIntentPreparationError.resourceChangedDuringHash
        }

        // The user-initiated foreground Files backup may supply a keyed
        // local asset tag. It is NOT a Server Device token; it only selects
        // a deterministic conflict-free Owner-root filename. The full hash
        // also changes the name when the actual edited original changes.
        let destinationName: String
        if let destinationTag {
            guard destinationTag.utf8.count == 24,
                  destinationTag.utf8.allSatisfy({
                      ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
                  }) else {
                throw XDriveIOSPhotoIntentPreparationError.originalNotEligible
            }
            let source = original.originalFilename as NSString
            let stem = source.deletingPathExtension
            let ext = source.pathExtension
            let prefix = String(stem.prefix(90))
            let suffix = "-xios-" + destinationTag + "-" + String(fullHash.prefix(12))
            destinationName = prefix + suffix + (ext.isEmpty ? "" : "." + ext)
        } else {
            destinationName = original.originalFilename
        }
        guard validServerFilename(destinationName) else {
            throw XDriveIOSPhotoIntentPreparationError.originalNotEligible
        }

        // Persist the existing transient PhotoKit localIdentifier only as
        // HMAC opaque fingerprint; the raw value stays out of the journal.
        // This makes no Server call and creates NO implicit backup task.
        return try await ledger.prepare(
            scope: scope,
            localIdentifier: localIdentifier,
            role: role,
            parentID: owner.rootNodeID,
            name: destinationName,
            byteSize: original.byteCount,
            sha256: fullHash
        )
    }

    private struct PhotoKitResourceStamp: Equatable {
        let modifiedAt: Date?
        let createdAt: Date?
        let width: Int
        let height: Int
    }

    private func currentResourceStamp(
        _ identifier: String, expectedName: String,
        role: XDrivePhotoSyncResourceRole
    ) throws -> PhotoKitResourceStamp {
        let access = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard access == .authorized || access == .limited,
              let asset = PHAsset.fetchAssets(
                withLocalIdentifiers: [identifier], options: nil
              ).firstObject,
              let evidence = XDrivePhotoKitResourceInspector.inspect(
                localIdentifier: identifier
              ),
              evidence.originalResourceManifestComplete,
              ((role == .still && asset.mediaType == .image &&
                !asset.mediaSubtypes.contains(.photoLive) &&
                !evidence.isVideo && !evidence.isLive &&
                evidence.stillFilename == expectedName) ||
               (role == .video && asset.mediaType == .video &&
                evidence.isVideo && evidence.videoFilename == expectedName)) else {
            throw XDriveIOSPhotoIntentPreparationError.resourceChangedDuringHash
        }
        return PhotoKitResourceStamp(
            modifiedAt: asset.modificationDate,
            createdAt: asset.creationDate,
            width: asset.pixelWidth,
            height: asset.pixelHeight
        )
    }

    private func hashStagedFile(_ url: URL, claimedSize: Int64) throws -> String {
        let fm = FileManager.default
        let attributes = try fm.attributesOfItem(atPath: url.path)
        guard (attributes[.type] as? FileAttributeType) == .typeRegular,
              let size = attributes[.size] as? NSNumber,
              size.int64Value == claimedSize else {
            throw XDriveIOSPhotoIntentPreparationError.invalidStagedOriginal
        }

        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var hash = SHA256()
        var readBytes: Int64 = 0
        while true {
            try Task.checkCancellation()
            guard let data = try file.read(upToCount: 8 * 1_048_576),
                  !data.isEmpty else { break }
            readBytes += Int64(data.count)
            guard readBytes <= claimedSize else {
                throw XDriveIOSPhotoIntentPreparationError.invalidStagedOriginal
            }
            hash.update(data: data)
        }
        let finalAttributes = try fm.attributesOfItem(atPath: url.path)
        guard readBytes == claimedSize,
              (finalAttributes[.type] as? FileAttributeType) == .typeRegular,
              let finalSize = finalAttributes[.size] as? NSNumber,
              finalSize.int64Value == claimedSize else {
            throw XDriveIOSPhotoIntentPreparationError.invalidStagedOriginal
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func validServerFilename(_ name: String) -> Bool {
        guard !name.isEmpty, name != ".", name != "..",
              name.utf8.count <= 255,
              !name.hasSuffix(" "), !name.hasSuffix(".") else { return false }
        let bad = Set<UInt32>([34, 42, 47, 58, 60, 62, 63, 92, 124])
        guard !name.unicodeScalars.contains(where: {
            $0.value < 32 || bad.contains($0.value)
        }) else { return false }
        let stem = (name.components(separatedBy: ".").first ?? "").uppercased()
        let reserved = Set([
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3",
            "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
            "LPT7", "LPT8", "LPT9"
        ])
        return !reserved.contains(stem)
    }
}
