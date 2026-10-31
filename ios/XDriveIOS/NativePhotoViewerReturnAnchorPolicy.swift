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
