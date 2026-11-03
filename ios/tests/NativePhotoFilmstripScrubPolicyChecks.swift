import Foundation

@main
struct NativePhotoFilmstripScrubPolicyChecks {
    static func main() {
        func check(_ ok: Bool, _ description: String) {
            guard ok else {
                fputs("Photo filmstrip scrub failure: \(description)\n", stderr)
                exit(1)
            }
        }
        let p = XDriveIOSNativePhotoFilmstripScrubPolicy.self
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: -18, vertical: 0, authorized: true) == 15,
              "first left photo")
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: 18, vertical: 0, authorized: true) == 13,
              "first right photo")
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: -64, vertical: 0, authorized: true) == 16,
              "two neighbors")
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: -17, vertical: 0, authorized: true) == nil,
              "tap remains tap")
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: -72, vertical: 60, authorized: true) == nil,
              "vertical pan")
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: -72, vertical: 48, authorized: true) == nil,
              "diagonal pan")
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: -72, vertical: 1, authorized: false) == nil,
              "permission revoked")
        check(p.targetIndex(startingAt: 0, loadedCount: 64,
                            horizontal: 1000, vertical: 0, authorized: true) == 0,
              "first page boundary")
        check(p.targetIndex(startingAt: 63, loadedCount: 64,
                            horizontal: -1000, vertical: 0, authorized: true) == 63,
              "last page boundary")
        check(p.targetIndex(startingAt: 7, loadedCount: 48,
                            horizontal: -3000, vertical: 0, authorized: true) == 47,
              "cloud 48 slot boundary")
        check(p.targetIndex(startingAt: 2, loadedCount: 65,
                            horizontal: -50, vertical: 0, authorized: true) == nil,
              "unbounded page")
        check(p.targetIndex(startingAt: 0, loadedCount: 1,
                            horizontal: -50, vertical: 0, authorized: true) == nil,
              "singleton page")
        check(p.targetIndex(startingAt: -1, loadedCount: 64,
                            horizontal: -50, vertical: 0, authorized: true) == nil,
              "negative starting index")
        check(p.targetIndex(startingAt: 64, loadedCount: 64,
                            horizontal: -50, vertical: 0, authorized: true) == nil,
              "out of page starting index")
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: .nan, vertical: 0, authorized: true) == nil,
              "NaN drag rejected")
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: -100, vertical: .infinity, authorized: true) == nil,
              "infinite vertical rejected")
        check(p.targetIndex(startingAt: 14, loadedCount: 64,
                            horizontal: -CGFloat.greatestFiniteMagnitude,
                            vertical: 0, authorized: true) == 63,
              "huge finite drag safely clamped")
        print("native photo filmstrip scrub policy checks passed")
    }
}
