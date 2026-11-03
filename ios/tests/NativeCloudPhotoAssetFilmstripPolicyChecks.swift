import Foundation

@main
struct NativeCloudFilmstripPolicyChecks {
    static func main() {
        func check(_ ok: Bool, _ reason: String) {
            guard ok else {
                fputs("cloud filmstrip policy failure: \(reason)\n", stderr)
                exit(1)
            }
        }
        func item(_ id: UInt64, _ revision: UInt64 = 9,
                  _ kind: String = "image",
                  _ name: String = "image.heic",
                  _ size: Int64 = 100)
            -> XDriveIOSNativeCloudFilmstripKey {
            XDriveIOSNativeCloudFilmstripKey(
                nodeID: id, revision: revision,
                name: name, size: size, kind: kind
            )
        }
        let page = (1...48).map { item(UInt64($0)) }
        let current = page[18]
        let policy = XDriveIOSNativeCloudFilmstripPolicy.self
        check(policy.maximumLoaded == 48, "48 item Owner page cap")
        check(policy.selectedIndex(current: current, in: page,
                                   authorized: true) == 18,
              "exact current media index")
        check(policy.target(current: current, requested: page[26],
                            in: page, authorized: true) == page[26],
              "select another loaded media")
        check(policy.target(current: current, requested: page[26],
                            in: page, authorized: false) == nil,
              "Owner revoked")
        check(policy.target(current: current, requested: item(49),
                            in: page, authorized: true) == nil,
              "unloaded Owner range")
        check(policy.target(current: current, requested: item(27, 8),
                            in: page, authorized: true) == nil,
              "old Node revision")
        check(policy.selectedIndex(current: item(19, 10), in: page,
                                   authorized: true) == nil,
              "current Node revised")
        check(policy.target(current: current, requested: item(27, 9, "video"),
                            in: page, authorized: true) == nil,
              "media kind changed")
        check(policy.target(current: current, requested: item(27, 9, "image", "other.heic"),
                            in: page, authorized: true) == nil,
              "filename identity changed")
        check(policy.selectedIndex(current: current, in: page + [item(49)],
                                   authorized: true) == nil,
              "unbounded Owner page")
        check(policy.selectedIndex(current: current, in: page + [page[8]],
                                   authorized: true) == nil,
              "duplicate Node identity")
        check(policy.selectedIndex(current: current, in: [],
                                   authorized: true) == nil,
              "empty Owner page")
        check(policy.selectedIndex(current: current, in: [current, item(88, 0)],
                                   authorized: true) == nil,
              "zero revision rejected")
        check(policy.selectedIndex(current: current, in: [current, item(88, 9, "other")],
                                   authorized: true) == nil,
              "unsupported kind rejected")
        check(policy.selectedIndex(current: current, in: [current, item(88, 9, "image", "x", -1)],
                                   authorized: true) == nil,
              "negative size rejected")
        print("native cloud PhotoAsset filmstrip policy checks passed")
    }
}
