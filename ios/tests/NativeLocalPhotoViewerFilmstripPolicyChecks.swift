import Foundation

@main
struct NativeLocalFilmstripPolicyChecks {
    static func main() {
        func check(_ ok: Bool, _ why: String) {
            guard ok else {
                fputs("filmstrip policy failure: \(why)\n", stderr)
                exit(1)
            }
        }
        func photo(_ n: Int, revision: Int = 1,
                   kind: String = "image", live: Bool = false)
            -> XDriveIOSNativeLocalFilmstripKey {
            XDriveIOSNativeLocalFilmstripKey(
                id: "photo-\(n)", kind: kind, isLive: live,
                capturedAt: Date(timeIntervalSince1970: Double(n)),
                modifiedAt: Date(timeIntervalSince1970: Double(revision))
            )
        }
        let page = (0..<64).map { photo($0) }
        let current = page[23]
        let p = XDriveIOSNativeLocalFilmstripPolicy.self
        check(p.maximumLoaded == 64, "max 64 loaded")
        check(p.selectedIndex(current: current, in: page, authorized: true) == 23, "exact current")
        check(p.target(current: current, requested: page[40], in: page, authorized: true) == page[40], "current-page target")
        check(p.target(current: current, requested: page[40], in: page, authorized: false) == nil, "revoked permission")
        check(p.target(current: current, requested: photo(65), in: page, authorized: true) == nil, "other page")
        check(p.target(current: current, requested: photo(40, revision: 2), in: page, authorized: true) == nil, "changed target revision")
        check(p.selectedIndex(current: photo(23, revision: 2), in: page, authorized: true) == nil, "changed current revision")
        check(p.selectedIndex(current: current, in: page + [photo(64)], authorized: true) == nil, "oversize page")
        check(p.selectedIndex(current: current, in: page + [current], authorized: true) == nil, "duplicate identifier")
        check(p.selectedIndex(current: current, in: [], authorized: true) == nil, "no page")
        check(p.selectedIndex(current: current, in: [current, photo(1, kind: "other")], authorized: true) == nil, "unsupported kind")
        check(p.selectedIndex(current: current, in: [current, photo(1, kind: "video", live: true)], authorized: true) == nil, "invalid live video")
        let long = XDriveIOSNativeLocalFilmstripKey(
            id: String(repeating: "x", count: 1025), kind: "image",
            isLive: false, capturedAt: nil, modifiedAt: nil
        )
        check(p.selectedIndex(current: current, in: [current, long], authorized: true) == nil, "invalid id length")
        check(p.target(current: current, requested: photo(40, kind: "video"), in: page, authorized: true) == nil, "changed kind")
        print("native local PhotoKit filmstrip policy checks passed")
    }
}
