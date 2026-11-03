import Foundation

/// One transient, exact Node from the Owner-scoped original Viewer window.
struct XDriveIOSNativeCloudOriginalFilmstripKey: Hashable {
    let nodeID: UInt64
    let revision: UInt64
    let name: String
    let type: String
    let size: Int64
    let kind: String
}

/// Selection never scans the root, merges ranges, or persists Node identity.
/// The Viewer independently checks Owner/root and the presenting page callback.
enum XDriveIOSNativeCloudOriginalFilmstripPolicy {
    static let maximumLoaded = 48

    private static func valid(_ item: XDriveIOSNativeCloudOriginalFilmstripKey) -> Bool {
        item.nodeID > 0 && item.revision > 0 &&
            item.type == "file" && item.size >= 0 &&
            !item.name.isEmpty && item.name.utf8.count <= 1024 &&
            (item.kind == "image" || item.kind == "video" || item.kind == "live")
    }

    static func loadedIndex(
        current: XDriveIOSNativeCloudOriginalFilmstripKey,
        in loaded: [XDriveIOSNativeCloudOriginalFilmstripKey],
        authorized: Bool
    ) -> Int? {
        guard authorized, valid(current), !loaded.isEmpty,
              loaded.count <= maximumLoaded,
              loaded.allSatisfy(valid),
              Set(loaded.map(\.nodeID)).count == loaded.count else { return nil }
        return loaded.firstIndex(of: current)
    }

    static func target(
        current: XDriveIOSNativeCloudOriginalFilmstripKey,
        requested: XDriveIOSNativeCloudOriginalFilmstripKey,
        in loaded: [XDriveIOSNativeCloudOriginalFilmstripKey],
        authorized: Bool
    ) -> XDriveIOSNativeCloudOriginalFilmstripKey? {
        guard loadedIndex(current: current, in: loaded,
                          authorized: authorized) != nil,
              valid(requested), loaded.contains(requested) else { return nil }
        return requested
    }
}
