import Foundation

@main
struct NativeCloudOriginalFilmstripPolicyChecks {
    static func main() {
        func check(_ result: Bool, _ message: String) {
            guard result else {
                fputs("cloud original filmstrip policy: \(message)\n", stderr)
                exit(1)
            }
        }
        func item(_ id: UInt64, rev: UInt64 = 7, name: String = "photo-xios-a.heic",
                  type: String = "file", size: Int64 = 100, kind: String = "image")
            -> XDriveIOSNativeCloudOriginalFilmstripKey {
            XDriveIOSNativeCloudOriginalFilmstripKey(
                nodeID: id, revision: rev, name: name, type: type,
                size: size, kind: kind
            )
        }
        let p = XDriveIOSNativeCloudOriginalFilmstripPolicy.self
        let loaded = (1...48).map { item(UInt64($0)) }
        let current = loaded[11]
        check(p.maximumLoaded == 48, "48 entry window")
        check(p.loadedIndex(current: current, in: loaded, authorized: true) == 11,
              "current exactly loaded")
        check(p.target(current: current, requested: loaded[21],
                       in: loaded, authorized: true) == loaded[21],
              "select loaded original")
        check(p.target(current: current, requested: loaded[21],
                       in: loaded, authorized: false) == nil,
              "Owner revoked")
        check(p.target(current: current, requested: item(49),
                       in: loaded, authorized: true) == nil,
              "outside current 48")
        check(p.target(current: current, requested: item(22, rev: 8),
                       in: loaded, authorized: true) == nil,
              "changed Node revision")
        check(p.target(current: current, requested: item(22, name: "other-xios-a.heic"),
                       in: loaded, authorized: true) == nil,
              "reused Node with different name")
        check(p.target(current: current, requested: item(22, size: 500),
                       in: loaded, authorized: true) == nil,
              "changed original size")
        check(p.target(current: current, requested: item(22, kind: "video"),
                       in: loaded, authorized: true) == nil,
              "changed media type")
        check(p.loadedIndex(current: item(12, rev: 8), in: loaded,
                            authorized: true) == nil,
              "current Node revised")
        check(p.loadedIndex(current: current, in: loaded + [item(49)],
                            authorized: true) == nil,
              "oversized window")
        check(p.loadedIndex(current: current, in: loaded + [current],
                            authorized: true) == nil,
              "duplicate Node ID")
        check(p.loadedIndex(current: current, in: [], authorized: true) == nil,
              "empty window")
        check(p.loadedIndex(current: current, in: [current, item(49, rev: 0)],
                            authorized: true) == nil,
              "zero revision")
        check(p.loadedIndex(current: current, in: [current, item(49, size: -1)],
                            authorized: true) == nil,
              "negative original size")
        check(p.loadedIndex(current: current, in: [current, item(49, type: "folder")],
                            authorized: true) == nil,
              "folder rejected")
        check(p.loadedIndex(current: current, in: [current, item(49, kind: "other")],
                            authorized: true) == nil,
              "unsupported file")
        check(p.loadedIndex(current: current, in: [current,
                            item(49, name: String(repeating: "x", count: 1025))],
                            authorized: true) == nil,
              "oversized name")
        check(p.loadedIndex(current: item(900, kind: "live"),
                            in: [item(900, kind: "live"), item(901, kind: "video")],
                            authorized: true) == 0,
              "Live ZIP placeholder admitted without thumbnail")
        print("native Cloud Originals filmstrip policy passed")
    }
}
