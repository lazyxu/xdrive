import Foundation

@main
struct XDriveIOSNativePhotoSearchQueryPolicyChecks {
    static func main() {
        typealias P = XDriveIOSNativePhotoSearchQueryPolicy
        precondition(P.normalized("  2026-11  ") == "2026-11")
        precondition(P.normalized(" IMG_0123.HEIC ") == "IMG_0123.HEIC")
        precondition(P.normalized("") == nil)
        precondition(P.normalized(" \n\t ") == nil)
        precondition(P.normalized("test\nquery") == nil)
        precondition(P.normalized(String(repeating: "甲", count: 81)) == nil)
        precondition(P.normalized(String(repeating: "🙂", count: 65)) == nil)

        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let captured = cal.date(from: DateComponents(
            year: 2026, month: 11, day: 3, hour: 12
        ))!
        for query in ["2026", "2026-11", "2026-11-03",
                      "2026年", "2026年11月", "11月", "11月3日"] {
            precondition(P.matchesDate(captured, query: query, calendar: cal))
        }
        for query in ["2025", "2026-12", "12月"] {
            precondition(!P.matchesDate(captured, query: query, calendar: cal))
        }
        precondition(!P.matchesDate(nil, query: "2026", calendar: cal))
        precondition(P.matchesKind("video", live: false, screenshot: false, query: "视频"))
        precondition(P.matchesKind("image", live: false, screenshot: false, query: "照片"))
        precondition(P.matchesKind("image", live: true, screenshot: false, query: "实况"))
        precondition(P.matchesKind("image", live: false, screenshot: true, query: "截屏"))
        precondition(!P.matchesKind("video", live: false, screenshot: false, query: "实况"))
        print("iOS bounded PhotoKit metadata search query policy: PASS")
    }
}
