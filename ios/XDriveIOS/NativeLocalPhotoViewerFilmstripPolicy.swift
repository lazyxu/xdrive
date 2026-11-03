import Foundation

/// Transient, exact PhotoKit media identity from one authorized Viewer window.
struct XDriveIOSNativeLocalFilmstripKey: Hashable {
    let id: String
    let kind: String
    let isLive: Bool
    let capturedAt: Date?
    let modifiedAt: Date?
}

/// This policy never scans PhotoKit, persists an ID, or crosses a 64-slot page.
enum XDriveIOSNativeLocalFilmstripPolicy {
    static let maximumLoaded = 64

    private static func valid(_ item: XDriveIOSNativeLocalFilmstripKey) -> Bool {
        !item.id.isEmpty && item.id.utf8.count <= 1024 &&
            (item.kind == "image" || item.kind == "video") &&
            (!item.isLive || item.kind == "image")
    }

    static func selectedIndex(
        current: XDriveIOSNativeLocalFilmstripKey,
        in loaded: [XDriveIOSNativeLocalFilmstripKey],
        authorized: Bool
    ) -> Int? {
        guard authorized, !loaded.isEmpty, loaded.count <= maximumLoaded,
              loaded.allSatisfy(valid), valid(current),
              Set(loaded.map(\.id)).count == loaded.count else { return nil }
        return loaded.firstIndex(of: current)
    }

    static func target(
        current: XDriveIOSNativeLocalFilmstripKey,
        requested: XDriveIOSNativeLocalFilmstripKey,
        in loaded: [XDriveIOSNativeLocalFilmstripKey],
        authorized: Bool
    ) -> XDriveIOSNativeLocalFilmstripKey? {
        guard selectedIndex(current: current, in: loaded, authorized: authorized) != nil,
              valid(requested), loaded.contains(requested) else { return nil }
        return requested
    }
}
