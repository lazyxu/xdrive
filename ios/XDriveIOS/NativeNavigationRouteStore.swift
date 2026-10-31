import Foundation

/// Only navigation hints are persisted. Never store PhotoKit local IDs,
/// preview tickets, credentials, media metadata, consent or upload receipts.
struct XDriveIOSNativeNavigationRouteSnapshot: Codable, Equatable {
    let version: Int
    let scopeHash: String
    let selectedTab: String
    let gallerySource: String
    let activeDynamic: String?
    let recentDynamic: [String]
    // Optional so the previous v1 snapshots continue decoding.
    let mapScope: String?
    let mapPageOffset: Int?
}

/// One fail-closed, server/Owner/root-scoped navigation snapshot. A different
/// verified Owner clears the previous snapshot, including A -> B -> A.
struct XDriveIOSNativeNavigationRouteStore {
    static let key = "xdrive.ios.native.navigation-route.v1"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func clear() {
        defaults.removeObject(forKey: Self.key)
    }

    func restore(scopeHash: String) -> XDriveIOSNativeNavigationRouteSnapshot? {
        guard validScopeHash(scopeHash) else {
            clear()
            return nil
        }
        guard let data = defaults.data(forKey: Self.key) else { return nil }
        guard data.count <= 2048,
              let saved = try? JSONDecoder().decode(
                XDriveIOSNativeNavigationRouteSnapshot.self, from: data
              ),
              saved.version == 1,
              saved.scopeHash == scopeHash,
              Self.validTab(saved.selectedTab),
              Self.validGallery(saved.gallerySource),
              Self.validDynamic(saved.activeDynamic),
              Self.validMapScope(saved.mapScope ?? "page"),
              Self.validMapPageOffset(saved.mapPageOffset ?? 0),
              saved.recentDynamic.count <= 6,
              saved.recentDynamic.allSatisfy({ $0 == "backup" })
        else {
            clear()
            return nil
        }
        // Never bring a dynamic tab up without a currently implemented route.
        guard saved.selectedTab != "dynamic" || saved.activeDynamic != nil else {
            clear()
            return nil
        }
        return saved
    }

    func save(
        scopeHash: String,
        selectedTab: String,
        gallerySource: String,
        activeDynamic: String?,
        recentDynamic: [String],
        mapScope: String = "page",
        mapPageOffset: Int = 0
    ) {
        guard validScopeHash(scopeHash) else { return }
        // Unknown/newer features and unavailable native routes are not
        // restored until their real Owner-authorized screens exist.
        // The native Gallery MapKit route is implemented, so map is allowed.
        let safeDynamic = activeDynamic == "backup" ? "backup" : nil
        let safeTab = Self.validTab(selectedTab) &&
            (selectedTab != "dynamic" || safeDynamic != nil)
            ? selectedTab : "gallery"
        let snapshot = XDriveIOSNativeNavigationRouteSnapshot(
            version: 1,
            scopeHash: scopeHash,
            selectedTab: safeTab,
            gallerySource: Self.validGallery(gallerySource) ? gallerySource : "local",
            activeDynamic: safeDynamic,
            recentDynamic: Array(recentDynamic.filter { $0 == "backup" }.prefix(6)),
            mapScope: Self.validMapScope(mapScope) ? mapScope : "page",
            mapPageOffset: Self.validMapPageOffset(mapPageOffset) ? mapPageOffset : 0
        )
        guard let data = try? JSONEncoder().encode(snapshot), data.count <= 2048 else {
            clear()
            return
        }
        defaults.set(data, forKey: Self.key)
    }

    private func validScopeHash(_ value: String) -> Bool {
        value.count == 64 && value.unicodeScalars.allSatisfy {
            ("0"..."9").contains(String($0)) || ("a"..."f").contains(String($0))
        }
    }

    private static func validTab(_ tab: String) -> Bool {
        ["launcher", "dynamic", "gallery", "files", "mine"].contains(tab)
    }

    private static func validGallery(_ source: String) -> Bool {
        ["local", "albums", "cloud", "originals", "map"].contains(source)
    }

    private static func validDynamic(_ feature: String?) -> Bool {
        feature == nil || feature == "backup"
    }

    private static func validMapScope(_ value: String) -> Bool {
        value == "page" || value == "library"
    }

    // A bounded start position, not a photo identity or coordinate.
    // The active authorized library is always reread on reentry.
    private static func validMapPageOffset(_ value: Int) -> Bool {
        value >= 0 && value <= 1_000_000 && value % 64 == 0
    }
}
