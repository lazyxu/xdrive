import Foundation

// A minimal compile-only dependency: the persisted route store is pure and
// must not require the SwiftUI app or an authenticated network fixture.
struct XDriveNativeOwnerRoot {
    let instanceID: String
    let ownerID: UInt64
    let rootNodeID: UInt64
    let origin: URL
}

@main
struct NativeFilesResumeChecks {
    private static func check(_ yes: @autoclosure () -> Bool, _ message: String) {
        if !yes() {
            fputs("Native Files resume: \(message)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        let suite = "xdrive-native-files-resume-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else { exit(1) }
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = XDriveIOSNativeFilesResumeStore(defaults: defaults)
        let a = XDriveNativeOwnerRoot(
            instanceID: "server-a", ownerID: 11, rootNodeID: 91,
            origin: URL(string: "https://a.example.test:443")!
        )
        let otherOwner = XDriveNativeOwnerRoot(
            instanceID: "server-a", ownerID: 12, rootNodeID: 91,
            origin: a.origin
        )
        let otherServer = XDriveNativeOwnerRoot(
            instanceID: "server-b", ownerID: 11, rootNodeID: 91,
            origin: a.origin
        )
        check(store.restore(owner: a) == nil, "fresh account has no saved route")
        store.saveSection("recent", owner: a)
        check(store.restore(owner: a)?.section == "recent", "Files-only section persists")
        store.saveFolder(
            owner: a, id: 123, name: "docs", pageOffset: 128,
            anchorID: 139, sort: "updated", order: "desc",
            grouping: "modified", foldersFirst: false
        )
        var saved = store.restore(owner: a)
        check(saved?.folderID == 123 && saved?.folderName == "docs", "last folder ID/name")
        check(saved?.pageOffset == 128 && saved?.anchorID == 139, "bounded page and anchor")
        check(saved?.sort == "updated" && saved?.grouping == "modified" &&
              saved?.foldersFirst == false, "arrangement survives process recreation")
        store.saveSection("favorites", owner: a)
        saved = store.restore(owner: a)
        check(saved?.section == "favorites" && saved?.folderID == 123,
              "Recent/Favorites switches retain Browse folder")
        store.saveAnchor(owner: a, folderID: 123, pageOffset: 256, anchorID: 180)
        check(store.restore(owner: a)?.anchorID == 180, "matching folder can move anchor")
        store.saveAnchor(owner: a, folderID: 999, pageOffset: 512, anchorID: 500)
        check(store.restore(owner: a)?.anchorID == 180,
              "unrelated folder never corrupts saved anchor")
        let onDisk = defaults.data(forKey: XDriveIOSNativeFilesResumeStore.key)!
        let raw = String(data: onDisk, encoding: .utf8)!
        check(!raw.contains("server-a") && !raw.contains("a.example.test"),
              "persist only hashed scope, never server identity text")
        check(store.restore(owner: otherOwner) == nil, "another Owner cannot restore")
        check(store.restore(owner: a) == nil, "mismatch clears old Owner route")
        store.saveFolder(
            owner: a, id: 123, name: "docs", pageOffset: 0,
            anchorID: nil, sort: "name", order: "asc",
            grouping: "none", foldersFirst: true
        )
        check(store.restore(owner: otherServer) == nil, "different instance cannot restore")
        store.saveSection("not-a-tab", owner: a)
        check(store.restore(owner: a) == nil, "invalid section never persists")
        store.saveFolder(
            owner: a, id: 123, name: "docs", pageOffset: 5,
            anchorID: 139, sort: "name", order: "asc",
            grouping: "none", foldersFirst: true
        )
        check(store.restore(owner: a) == nil, "unaligned page is rejected")
        print("Native Files scoped resume policy: PASS")
    }
}
