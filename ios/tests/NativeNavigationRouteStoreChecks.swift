import Foundation

@inline(__always) func require(_ condition: @autoclosure () -> Bool, _ why: String) {
    if !condition() { fputs("navigation route check failed: \(why)\n", stderr); exit(1) }
}

@main
struct XDriveNativeRouteChecks {
    static func main() {
        let suiteName = "xdrive.ios.route-checks.20261030"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = XDriveIOSNativeNavigationRouteStore(defaults: defaults)
        let ownerA = String(repeating: "a", count: 64)
        let ownerB = String(repeating: "b", count: 64)

        require(store.restore(scopeHash: ownerA) == nil, "initial state must not restore")
        store.save(scopeHash: ownerA, selectedTab: "dynamic", gallerySource: "albums",
                   activeDynamic: "backup", recentDynamic: ["backup", "storage", "sync"])
        let restored = store.restore(scopeHash: ownerA)
        require(restored?.selectedTab == "dynamic", "authorized dynamic route")
        require(restored?.gallerySource == "albums", "gallery source")
        require(restored?.activeDynamic == "backup", "implemented feature")
        require(restored?.recentDynamic == ["backup"], "drop unsupported feature history")

        // A -> B is destructive, and B -> A must never replay the old snapshot.
        require(store.restore(scopeHash: ownerB) == nil, "cross-Owner restore blocked")
        require(store.restore(scopeHash: ownerA) == nil, "cross-Owner data purged")
        store.save(scopeHash: ownerB, selectedTab: "dynamic", gallerySource: "map",
                   activeDynamic: "storage", recentDynamic: ["storage"])
        require(store.restore(scopeHash: ownerB)?.selectedTab == "gallery", "unimplemented dynamic fallback")
        require(store.restore(scopeHash: ownerB)?.gallerySource == "map", "native map is now a supported Gallery source")

        // Gallery map is an implemented native MapKit route, not a placeholder;
        // it is still only a navigation hint, never a persisted GPS or asset ID.
        store.save(scopeHash: ownerB, selectedTab: "gallery", gallerySource: "map",
                   activeDynamic: nil, recentDynamic: [])
        require(store.restore(scopeHash: ownerB)?.gallerySource == "map",
                "restores verified Owner Gallery map route")
        store.save(scopeHash: ownerB, selectedTab: "gallery", gallerySource: "missing",
                   activeDynamic: nil, recentDynamic: [])
        require(store.restore(scopeHash: ownerB)?.gallerySource == "local",
                "unknown Gallery sources still fail closed")

        store.save(scopeHash: ownerB, selectedTab: "files", gallerySource: "cloud",
                   activeDynamic: nil, recentDynamic: [])
        require(store.restore(scopeHash: ownerB)?.selectedTab == "files", "fixed tab restore")
        require(store.restore(scopeHash: ownerB)?.gallerySource == "cloud", "cloud source only as route")

        store.save(scopeHash: ownerB, selectedTab: "gallery", gallerySource: "originals",
                   activeDynamic: nil, recentDynamic: [])
        require(store.restore(scopeHash: ownerB)?.gallerySource == "originals",
                "verified backed-up originals route")
        // A malformed / oversized persisted blob cannot allocate an unbounded
        // UI state, change Owner identity, or crash route restoration.
        defaults.set(Data(repeating: 0x41, count: 8192),
                     forKey: XDriveIOSNativeNavigationRouteStore.key)
        require(store.restore(scopeHash: ownerB) == nil, "oversized payload denied")
        require(defaults.object(forKey: XDriveIOSNativeNavigationRouteStore.key) == nil,
                "invalid payload removed")
        store.save(scopeHash: "not-a-hash", selectedTab: "gallery", gallerySource: "local",
                   activeDynamic: nil, recentDynamic: [])
        require(defaults.object(forKey: XDriveIOSNativeNavigationRouteStore.key) == nil,
                "unverified scope never persisted")
        store.save(scopeHash: ownerB, selectedTab: "gallery", gallerySource: "map",
                   activeDynamic: nil, recentDynamic: [],
                   mapScope: "page", mapPageOffset: 128)
        require(store.restore(scopeHash: ownerB)?.mapScope == "page",
                "map mode can resume")
        require(store.restore(scopeHash: ownerB)?.mapPageOffset == 128,
                "page cursor can resume")
        store.save(scopeHash: ownerB, selectedTab: "gallery", gallerySource: "map",
                   activeDynamic: nil, recentDynamic: [],
                   mapScope: "library", mapPageOffset: 128)
        require(store.restore(scopeHash: ownerB)?.mapScope == "library",
                "library mode requires new explicit scan on entry")
        require(store.restore(scopeHash: ownerB)?.mapPageOffset == 128,
                "last page remembered while selecting full library")
        store.save(scopeHash: ownerB, selectedTab: "gallery", gallerySource: "map",
                   activeDynamic: nil, recentDynamic: [],
                   mapScope: "invalid", mapPageOffset: -64)
        require(store.restore(scopeHash: ownerB)?.mapScope == "page",
                "unsupported scan mode sanitized")
        require(store.restore(scopeHash: ownerB)?.mapPageOffset == 0,
                "negative cursor sanitized")
        store.save(scopeHash: ownerB, selectedTab: "gallery", gallerySource: "map",
                   activeDynamic: nil, recentDynamic: [],
                   mapScope: "page", mapPageOffset: 65)
        require(store.restore(scopeHash: ownerB)?.mapPageOffset == 0,
                "unaligned cursor sanitized")
        store.save(scopeHash: ownerB, selectedTab: "gallery", gallerySource: "map",
                   activeDynamic: nil, recentDynamic: [],
                   mapScope: "page", mapPageOffset: 1_000_064)
        require(store.restore(scopeHash: ownerB)?.mapPageOffset == 0,
                "out-of-range cursor sanitized")
        // Legacy v1 snapshots had neither optional field.
        let legacy = """
        {"version":1,"scopeHash":"\(ownerB)","selectedTab":"gallery",
        "gallerySource":"map","activeDynamic":null,"recentDynamic":[]}
        """.data(using: .utf8)!
        defaults.set(legacy, forKey: XDriveIOSNativeNavigationRouteStore.key)
        require(store.restore(scopeHash: ownerB)?.mapScope == nil,
                "legacy v1 route snapshot decodes without mode")
        require(store.restore(scopeHash: ownerB)?.mapPageOffset == nil,
                "legacy v1 route snapshot decodes without cursor")
        // Tampered persisted data fails closed instead of replaying a stale
        // unverified page or crossing Owner identity.
        let bad = XDriveIOSNativeNavigationRouteSnapshot(
            version: 1, scopeHash: ownerB, selectedTab: "gallery",
            gallerySource: "map", activeDynamic: nil, recentDynamic: [],
            mapScope: "page", mapPageOffset: 65
        )
        defaults.set(try! JSONEncoder().encode(bad),
                     forKey: XDriveIOSNativeNavigationRouteStore.key)
        require(store.restore(scopeHash: ownerB) == nil,
                "tampered map cursor denied")
        require(defaults.object(forKey: XDriveIOSNativeNavigationRouteStore.key) == nil,
                "invalid snapshot removed")
        store.save(scopeHash: ownerB, selectedTab: "gallery", gallerySource: "map",
                   activeDynamic: nil, recentDynamic: [],
                   mapScope: "page", mapPageOffset: 192)
        require(store.restore(scopeHash: ownerA) == nil,
                "map cursor never crosses Owner")
        print("native iOS navigation route scoped persistence checks passed")
    }
}
