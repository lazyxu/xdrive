import Foundation
import Photos

/// Native Photos operations are explicit, user-triggered PhotoKit writes.
/// Only the authorized native photo library is changed; this module has no network or persistent writer.
enum XDriveIOSNativeLocalPhotoActionError: Error {
    case unauthorized
    case staleSelection
    case invalidSelection
}

@MainActor
enum XDriveIOSNativeLocalPhotoSelectionActions {
    static func verifiedAssets(_ candidates: [XDrivePhotoKitScanCandidate]) throws -> [PHAsset] {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            throw XDriveIOSNativeLocalPhotoActionError.unauthorized
        }
        guard !candidates.isEmpty,
              candidates.count <= XDriveIOSNativePhotoSelectionPolicy.maximumItems,
              candidates.allSatisfy({ !$0.id.isEmpty && $0.id.utf8.count <= 1024 }),
              Set(candidates.map(\.id)).count == candidates.count
        else { throw XDriveIOSNativeLocalPhotoActionError.invalidSelection }

        let fetch = PHAsset.fetchAssets(
            withLocalIdentifiers: candidates.map(\.id), options: nil
        )
        var current: [String: PHAsset] = [:]
        fetch.enumerateObjects { asset, _, _ in current[asset.localIdentifier] = asset }
        guard current.count == candidates.count else {
            throw XDriveIOSNativeLocalPhotoActionError.staleSelection
        }
        return try candidates.map { expected in
            guard let asset = current[expected.id],
                  asset.creationDate == expected.capturedAt,
                  asset.modificationDate == expected.modifiedAt,
                  ((expected.kind == "image" && asset.mediaType == .image &&
                    expected.isLive == asset.mediaSubtypes.contains(.photoLive)) ||
                   (expected.kind == "video" && asset.mediaType == .video))
            else { throw XDriveIOSNativeLocalPhotoActionError.staleSelection }
            return asset
        }
    }

    static func setFavorite(_ candidates: [XDrivePhotoKitScanCandidate], to value: Bool) async throws {
        let assets = try verifiedAssets(candidates)
        try Task.checkCancellation()
        try await PHPhotoLibrary.shared().performChanges {
            for asset in assets {
                PHAssetChangeRequest(for: asset).isFavorite = value
            }
        }
    }

    static func delete(_ candidates: [XDrivePhotoKitScanCandidate]) async throws {
        let assets = try verifiedAssets(candidates)
        try Task.checkCancellation()
        // The system may present its own destructive permission confirmation.
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetChangeRequest.deleteAssets(assets as NSArray)
        }
    }
}
