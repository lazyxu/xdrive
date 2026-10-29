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
                      staged: XDriveStagedPhotoKitAsset) async throws
        -> XDrivePhotoSyncOperation {
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
              staged.kind == "image", staged.resources.count == 1,
              let original = staged.resources.first,
              original.role == "still",
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
        try assertStillVisible(localIdentifier, expectedName: original.originalFilename)

        let fullHash = try hashStagedFile(
            original.fileURL, claimedSize: original.byteCount
        )
        try Task.checkCancellation()

        // The Photos permission and resource manifest must still allow this
        // exact single original after reading the whole staged byte stream.
        try assertStillVisible(localIdentifier, expectedName: original.originalFilename)

        // Persist the existing transient PhotoKit localIdentifier only as
        // HMAC opaque fingerprint; the raw value stays out of the journal.
        // This makes no Server call and creates NO implicit backup task.
        return try await ledger.prepare(
            scope: scope,
            localIdentifier: localIdentifier,
            role: .still,
            parentID: owner.rootNodeID,
            name: original.originalFilename,
            byteSize: original.byteCount,
            sha256: fullHash
        )
    }

    private func assertStillVisible(_ identifier: String,
                                    expectedName: String) throws {
        guard let evidence = XDrivePhotoKitResourceInspector.inspect(
            localIdentifier: identifier
        ), evidence.originalResourceManifestComplete,
              !evidence.isVideo, !evidence.isLive,
              evidence.stillFilename == expectedName else {
            throw XDriveIOSPhotoIntentPreparationError.resourceChangedDuringHash
        }
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
        guard readBytes == claimedSize,
              let finalSize = (try? fm.attributesOfItem(atPath: url.path)[.size])
                    as? NSNumber,
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
        return !name.unicodeScalars.contains {
            $0.value < 32 || bad.contains($0.value)
        }
    }
}
