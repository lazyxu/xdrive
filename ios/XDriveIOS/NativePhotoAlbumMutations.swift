import Foundation
import Photos

enum XDriveIOSNativeAlbumMutationFailure: Error {
    case unauthorized
    case invalidName
    case collectionChanged
    case unsupportedCollection
    case membershipChanged
    case resultUnconfirmed
}

/// Only iOS PhotoKit user albums are modified. None of these operations
/// uploads, removes or renames an xDrive Server Node or backup original.
@MainActor
enum XDriveIOSNativePhotoAlbumMutations {
    private static func authorized() -> Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return status == .authorized || status == .limited
    }

    private static func currentUserAlbum(
        _ album: XDriveLocalPhotoAlbumSummary,
        operation: PHCollectionEditOperation
    ) throws -> PHAssetCollection {
        guard authorized() else { throw XDriveIOSNativeAlbumMutationFailure.unauthorized }
        guard album.kind == "用户相册",
              !album.collectionIdentifier.isEmpty,
              let collection = PHAssetCollection.fetchAssetCollections(
                withLocalIdentifiers: [album.collectionIdentifier], options: nil
              ).firstObject,
              collection.assetCollectionType == .album,
              collection.localIdentifier == album.collectionIdentifier,
              (collection.localizedTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
               ?? "未命名相册") == album.name
        else { throw XDriveIOSNativeAlbumMutationFailure.collectionChanged }
        guard collection.canPerform(operation) else {
            throw XDriveIOSNativeAlbumMutationFailure.unsupportedCollection
        }
        return collection
    }

    private static func confirmedAlbum(_ id: String) -> PHAssetCollection? {
        PHAssetCollection.fetchAssetCollections(
            withLocalIdentifiers: [id], options: nil
        ).firstObject
    }

    private static func hasMembers(
        _ assets: [PHAsset], in collection: PHAssetCollection,
        every: Bool
    ) -> Bool {
        let wanted = Set(assets.map(\.localIdentifier))
        guard !wanted.isEmpty else { return false }
        var seen = Set<String>()
        let members = PHAsset.fetchAssets(in: collection, options: nil)
        members.enumerateObjects { member, _, stop in
            if wanted.contains(member.localIdentifier) {
                seen.insert(member.localIdentifier)
                if seen.count == wanted.count { stop.pointee = true }
            }
        }
        return every ? seen == wanted : seen.isEmpty
    }

    static func create(_ proposedName: String) async throws {
        guard authorized() else { throw XDriveIOSNativeAlbumMutationFailure.unauthorized }
        guard let name = XDriveIOSNativeAlbumNamePolicy.normalized(proposedName) else {
            throw XDriveIOSNativeAlbumMutationFailure.invalidName
        }
        try Task.checkCancellation()
        try await PHPhotoLibrary.shared().performChanges {
            _ = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(
                withTitle: name
            )
        }
        guard authorized() else { throw XDriveIOSNativeAlbumMutationFailure.unauthorized }
    }

    static func rename(
        _ album: XDriveLocalPhotoAlbumSummary, to proposedName: String
    ) async throws {
        guard let name = XDriveIOSNativeAlbumNamePolicy.normalized(proposedName) else {
            throw XDriveIOSNativeAlbumMutationFailure.invalidName
        }
        let current = try currentUserAlbum(album, operation: .rename)
        guard name != album.name else { return }
        try Task.checkCancellation()
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetCollectionChangeRequest(for: current)?.title = name
        }
        guard authorized(), confirmedAlbum(album.collectionIdentifier)?.localizedTitle == name
        else { throw XDriveIOSNativeAlbumMutationFailure.resultUnconfirmed }
    }

    static func delete(_ album: XDriveLocalPhotoAlbumSummary) async throws {
        let current = try currentUserAlbum(album, operation: .delete)
        try Task.checkCancellation()
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetCollectionChangeRequest.deleteAssetCollections([current] as NSArray)
        }
        guard authorized(), confirmedAlbum(album.collectionIdentifier) == nil
        else { throw XDriveIOSNativeAlbumMutationFailure.resultUnconfirmed }
        // Removing a user album does not remove its member photos from the library.
    }

    static func add(
        _ candidates: [XDrivePhotoKitScanCandidate],
        to album: XDriveLocalPhotoAlbumSummary
    ) async throws {
        let current = try currentUserAlbum(album, operation: .addContent)
        let originals = try XDriveIOSNativeLocalPhotoSelectionActions.verifiedAssets(
            candidates
        )
        try Task.checkCancellation()
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetCollectionChangeRequest(for: current)?.addAssets(originals as NSArray)
        }
        guard authorized(),
              let updated = confirmedAlbum(album.collectionIdentifier),
              hasMembers(originals, in: updated, every: true)
        else { throw XDriveIOSNativeAlbumMutationFailure.resultUnconfirmed }
    }

    static func remove(
        _ candidates: [XDrivePhotoKitScanCandidate],
        from album: XDriveLocalPhotoAlbumSummary
    ) async throws {
        let current = try currentUserAlbum(album, operation: .removeContent)
        let originals = try XDriveIOSNativeLocalPhotoSelectionActions.verifiedAssets(
            candidates
        )
        guard hasMembers(originals, in: current, every: true) else {
            throw XDriveIOSNativeAlbumMutationFailure.membershipChanged
        }
        try Task.checkCancellation()
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetCollectionChangeRequest(for: current)?.removeAssets(originals as NSArray)
        }
        guard authorized(),
              let updated = confirmedAlbum(album.collectionIdentifier),
              hasMembers(originals, in: updated, every: false)
        else { throw XDriveIOSNativeAlbumMutationFailure.resultUnconfirmed }
        // Removal only changes album membership, not the Photos library asset.
    }
}
