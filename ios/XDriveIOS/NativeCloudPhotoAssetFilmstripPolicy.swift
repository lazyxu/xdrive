import Foundation

/// Value-only identity for one already-authorized, revision-scoped cloud item.
/// No Owner token, signed URL, or persistent metadata enters the filmstrip.
struct XDriveIOSNativeCloudFilmstripKey: Hashable {
    let nodeID: UInt64
    let revision: UInt64
    let name: String
    let size: Int64
    let kind: String
}

enum XDriveIOSNativeCloudFilmstripPolicy {
    static let maximumLoaded = 48

    private static func valid(_ item: XDriveIOSNativeCloudFilmstripKey) -> Bool {
        item.nodeID > 0 && item.revision > 0 && item.size >= 0 &&
            !item.name.isEmpty && item.name.utf8.count <= 255 &&
            (item.kind == "image" || item.kind == "video" || item.kind == "live")
    }

    static func selectedIndex(
        current: XDriveIOSNativeCloudFilmstripKey,
        in loaded: [XDriveIOSNativeCloudFilmstripKey],
        authorized: Bool
    ) -> Int? {
        guard authorized, valid(current), !loaded.isEmpty,
              loaded.count <= maximumLoaded, loaded.allSatisfy(valid),
              Set(loaded.map(\.nodeID)).count == loaded.count else { return nil }
        return loaded.firstIndex(of: current)
    }

    static func target(
        current: XDriveIOSNativeCloudFilmstripKey,
        requested: XDriveIOSNativeCloudFilmstripKey,
        in loaded: [XDriveIOSNativeCloudFilmstripKey],
        authorized: Bool
    ) -> XDriveIOSNativeCloudFilmstripKey? {
        guard selectedIndex(current: current, in: loaded,
                            authorized: authorized) != nil,
              valid(requested), loaded.contains(requested) else { return nil }
        return requested
    }
}
