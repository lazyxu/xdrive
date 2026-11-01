import Foundation

/// A value-only snapshot of one already-authorized PhotoAsset Range entry.
/// No signed URL, PhotoAsset bytes, Owner token or persistent cache lives here.
struct XDriveIOSNativePhotoAssetViewerNeighborKey: Equatable {
    let nodeID: UInt64
    let revision: UInt64
    let previewable: Bool
}

enum XDriveIOSNativePhotoAssetViewerNeighborPolicy {
    static let maximumLoaded = 48

    /// Only exact IDs AND revisions from a unique, bounded current Owner page
    /// qualify. "ownerAuthorized" must be checked against the verified
    /// Server/Owner/root identity by the presenting native Viewer.
    static func loadedIndex(
        current: XDriveIOSNativePhotoAssetViewerNeighborKey,
        in loaded: [XDriveIOSNativePhotoAssetViewerNeighborKey],
        ownerAuthorized: Bool
    ) -> Int? {
        guard ownerAuthorized, current.previewable, current.nodeID > 0,
              current.revision > 0,
              !loaded.isEmpty, loaded.count <= maximumLoaded,
              loaded.allSatisfy({
                $0.nodeID > 0 && $0.revision > 0
              }),
              Set(loaded.map(\.nodeID)).count == loaded.count
        else { return nil }
        return loaded.firstIndex(of: current)
    }

    static func neighborIndex(
        current: XDriveIOSNativePhotoAssetViewerNeighborKey,
        in loaded: [XDriveIOSNativePhotoAssetViewerNeighborKey],
        direction: Int,
        ownerAuthorized: Bool
    ) -> Int? {
        guard direction == -1 || direction == 1,
              let index = loadedIndex(
                current: current, in: loaded, ownerAuthorized: ownerAuthorized
              ) else { return nil }
        let neighbor = index + direction
        guard loaded.indices.contains(neighbor), loaded[neighbor].previewable
        else { return nil }
        return neighbor
    }
}
