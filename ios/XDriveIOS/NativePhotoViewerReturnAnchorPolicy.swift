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
}
