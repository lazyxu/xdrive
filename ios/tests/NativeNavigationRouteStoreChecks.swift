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
        require(store.restore(scopeHash: ownerB)?.gallerySource == "local", "map placeholder fallback")

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
        print("native iOS navigation route scoped persistence checks passed")
    }
}
