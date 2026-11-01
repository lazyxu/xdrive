import Foundation

/// A transient in-memory PhotoKit tile anchor. Never persist a localIdentifier.
/// A Viewer return can scroll only after the same bounded, currently authorized
/// page has been re-read and still contains the opened asset.
enum XDriveIOSNativePhotoViewerReturnAnchorPolicy {
    static func target(
        _ lastOpenedID: String?,
        in currentPageIDs: [String],
        authorized: Bool
    ) -> String? {
        guard authorized,
              let lastOpenedID,
              !lastOpenedID.isEmpty,
              lastOpenedID.utf8.count <= 1024,
              currentPageIDs.count <= 64 else { return nil }
        return currentPageIDs.contains(lastOpenedID) ? lastOpenedID : nil
    }

    /// Local Viewer neighbors must belong to this one authorized 64-slot
    /// PhotoKit page. No library-wide cursor or saved local ID is accepted.
    static func localLoadedIndex(
        currentID: String,
        in pageIDs: [String],
        authorized: Bool
    ) -> Int? {
        guard authorized, !currentID.isEmpty, currentID.utf8.count <= 1024,
              !pageIDs.isEmpty, pageIDs.count <= 64,
              pageIDs.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 1024 }),
              Set(pageIDs).count == pageIDs.count
        else { return nil }
        return pageIDs.firstIndex(of: currentID)
    }

    static func localNeighborID(
        currentID: String,
        in pageIDs: [String],
        direction: Int,
        authorized: Bool
    ) -> String? {
        guard direction == -1 || direction == 1,
              let index = localLoadedIndex(
                currentID: currentID, in: pageIDs, authorized: authorized
              ),
              pageIDs.indices.contains(index + direction)
        else { return nil }
        return pageIDs[index + direction]
    }

    /// Cloud PhotoAsset return targets are transient. An item can keep its
    /// Node ID across revisions, so matching the ID alone may highlight a
    /// different revision after a page refresh. The caller also fences the
    /// same verified Server/Owner/root and current active scene.
    static func cloudTarget(
        lastOpenedID: UInt64?,
        lastOpenedRevision: UInt64?,
        in currentPage: [(id: UInt64, revision: UInt64)],
        ownerAuthorized: Bool
    ) -> UInt64? {
        guard ownerAuthorized,
              let lastOpenedID, lastOpenedID > 0,
              let lastOpenedRevision, lastOpenedRevision > 0,
              currentPage.count <= 48,
              currentPage.allSatisfy({ $0.id > 0 && $0.revision > 0 }),
              Set(currentPage.map(\.id)).count == currentPage.count
        else { return nil }
        return currentPage.contains {
            $0.id == lastOpenedID && $0.revision == lastOpenedRevision
        } ? lastOpenedID : nil
    }
}
