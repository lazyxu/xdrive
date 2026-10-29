import Foundation
import Photos

/// Read-only, bounded PhotoKit album page. IDs are ephemeral view keys:
/// no PHCollection.localIdentifier or user media is persisted or uploaded.
struct XDriveLocalPhotoAlbumSummary: Identifiable {
    let id: String
    let name: String
    let kind: String
    let accessibleAssetCount: Int
}

struct XDriveLocalPhotoAlbumPage {
    let items: [XDriveLocalPhotoAlbumSummary]
    let offset: Int
    let total: Int
    let limitedAuthorization: Bool

    var hasPrevious: Bool { offset > 0 }
    var hasNext: Bool { offset + items.count < total }
}

enum XDriveLocalPhotoAlbumFailure: Error {
    case notAuthorized
    case invalidRange
    case authorizationChanged
}

/// A lazy index across iOS user and smart albums. It does not expand every
/// folder or fetch media bytes for each collection, and it respects iOS
/// limited Photos permission. Album membership counts can overlap.
enum XDriveLocalPhotoAlbumPager {
    static let pageSize = 32

    static func readPage(offset: Int) async throws -> XDriveLocalPhotoAlbumPage {
        guard offset >= 0, offset <= 10_000 else {
            throw XDriveLocalPhotoAlbumFailure.invalidRange
        }
        let startStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard startStatus == .authorized || startStatus == .limited else {
            throw XDriveLocalPhotoAlbumFailure.notAuthorized
        }
        return try await Task.detached(priority: .userInitiated) {
            let userAlbums = PHAssetCollection.fetchAssetCollections(
                with: .album, subtype: .any, options: nil
            )
            let smartAlbums = PHAssetCollection.fetchAssetCollections(
                with: .smartAlbum, subtype: .any, options: nil
            )
            let total = userAlbums.count + smartAlbums.count
            guard offset <= total else {
                throw XDriveLocalPhotoAlbumFailure.invalidRange
            }
            var rows: [XDriveLocalPhotoAlbumSummary] = []
            let end = min(total, offset + pageSize)
            if end > offset {
                for position in offset..<end {
                    try Task.checkCancellation()
                    let album: PHAssetCollection
                    let kind: String
                    if position < userAlbums.count {
                        album = userAlbums.object(at: position)
                        kind = "用户相册"
                    } else {
                        album = smartAlbums.object(at: position - userAlbums.count)
                        kind = "系统智能相册"
                    }
                    let name = album.localizedTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
                    rows.append(XDriveLocalPhotoAlbumSummary(
                        id: "album-page-\(position)", name: name?.isEmpty == false ? name! : "未命名相册",
                        kind: kind,
                        accessibleAssetCount: PHAsset.fetchAssets(in: album, options: nil).count
                    ))
                }
            }
            // Revoked or reduced Photos permission while enumerating must not
            // show stale private album metadata or silently change scope.
            let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            guard current == startStatus else {
                throw XDriveLocalPhotoAlbumFailure.authorizationChanged
            }
            return XDriveLocalPhotoAlbumPage(
                items: rows, offset: offset, total: total,
                limitedAuthorization: current == .limited
            )
        }.value
    }
}
