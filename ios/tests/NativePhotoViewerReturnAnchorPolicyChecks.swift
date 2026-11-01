import Foundation

@main
struct XDriveNativePhotoViewerReturnAnchorChecks {
    static func main() {
        let ids = (0..<64).map { "photo-\($0)" }
        func check(_ condition: Bool, _ reason: String) {
            guard condition else {
                fputs("viewer anchor failure: \(reason)\n", stderr)
                exit(1)
            }
        }
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("photo-39", in: ids, authorized: true) == "photo-39", "same page target")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("photo-39", in: ids, authorized: false) == nil, "revoked PhotoKit permission")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("deleted", in: ids, authorized: true) == nil, "changed library")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target(nil, in: ids, authorized: true) == nil, "no Viewer")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("", in: ids, authorized: true) == nil, "empty identity")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target(String(repeating: "x", count: 1025), in: ids, authorized: true) == nil, "oversized identity")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("photo-39", in: ids + ["extra"], authorized: true) == nil, "unbounded page")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("photo-38", in: Array(ids[0..<32]), authorized: true) == nil, "other page")
        // Indexed cloud Viewer: exact Node ID + revision in the same current
        // bounded, authorized Owner page; never accept a reused/stale ID.
        let cloudPage: [(id: UInt64, revision: UInt64)] = (1...48).map {
            (id: UInt64($0), revision: 9)
        }
        func cloud(_ id: UInt64?, _ revision: UInt64?,
                   _ page: [(id: UInt64, revision: UInt64)],
                   _ authorized: Bool = true) -> UInt64? {
            XDriveIOSNativePhotoViewerReturnAnchorPolicy.cloudTarget(
                lastOpenedID: id, lastOpenedRevision: revision,
                in: page, ownerAuthorized: authorized
            )
        }
        check(cloud(39, 9, cloudPage) == 39, "same Owner/current revision")
        check(cloud(39, 9, cloudPage, false) == nil, "revoked Owner")
        check(cloud(39, 8, cloudPage) == nil, "older revision")
        check(cloud(39, 10, cloudPage) == nil, "newer revision")
        check(cloud(49, 9, cloudPage) == nil, "item not on page")
        check(cloud(0, 9, cloudPage) == nil, "zero Node ID")
        check(cloud(39, 0, cloudPage) == nil, "zero revision")
        check(cloud(nil, 9, cloudPage) == nil, "missing Node")
        check(cloud(39, nil, cloudPage) == nil, "missing revision")
        check(cloud(39, 9, cloudPage + [(id: 49, revision: 9)]) == nil,
              "unbounded range")
        check(cloud(39, 9, cloudPage + [cloudPage[38]]) == nil,
              "duplicate current ID")
        check(cloud(39, 9, [(id: 39, revision: 9), (id: 39, revision: 10)]) == nil,
              "ambiguous revision for same ID")
        check(cloud(39, 9, [(id: 39, revision: 0)]) == nil,
              "invalid page revision")
        // L3 local Viewer next/previous operates only in the already
        // authorized 64-item PhotoKit window, without a new library scan.
        let localPage = (0..<64).map { "photo-\($0)" }
        func localIndex(_ current: String, _ page: [String] = localPage,
                        _ allowed: Bool = true) -> Int? {
            XDriveIOSNativePhotoViewerReturnAnchorPolicy.localLoadedIndex(
                currentID: current, in: page, authorized: allowed
            )
        }
        func neighbor(_ current: String, _ direction: Int,
                      _ page: [String] = localPage,
                      _ allowed: Bool = true) -> String? {
            XDriveIOSNativePhotoViewerReturnAnchorPolicy.localNeighborID(
                currentID: current, in: page, direction: direction,
                authorized: allowed
            )
        }
        check(localIndex("photo-33") == 33, "current loaded item")
        check(neighbor("photo-33", -1) == "photo-32", "previous loaded item")
        check(neighbor("photo-33", 1) == "photo-34", "next loaded item")
        check(neighbor("photo-0", -1) == nil, "first loaded edge")
        check(neighbor("photo-63", 1) == nil, "last loaded edge")
        check(neighbor("photo-33", 0) == nil, "invalid zero direction")
        check(neighbor("photo-33", 2) == nil, "invalid skipped direction")
        check(neighbor("photo-33", 1, localPage, false) == nil,
              "revoked PhotoKit permission")
        check(localIndex("photo-33", localPage, false) == nil,
              "revoked input focus")
        check(neighbor("missing", 1) == nil, "evicted source")
        check(neighbor("photo-33", 1, localPage + ["extra"]) == nil,
              "unbounded page")
        check(neighbor("photo-33", 1,
                       localPage + ["photo-33"]) == nil,
              "duplicate local identifier")
        check(neighbor("photo-33", 1,
                       ["photo-33", ""]) == nil,
              "malformed empty local identifier")
        check(neighbor("photo-33", 1,
                       ["photo-33", String(repeating: "x", count: 1025)]) == nil,
              "malformed oversized local identifier")
        check(neighbor("photo-33", 1, []) == nil, "empty page")

        print("native PhotoKit Viewer tile anchor policy checks passed")
    }
}
