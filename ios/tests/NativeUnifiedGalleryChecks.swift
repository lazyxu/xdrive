import Foundation

@main
struct NativeUnifiedGalleryChecks {
    static func main() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var query = XDriveIOSNativeUnifiedGalleryQuery()
        precondition(query.matches(video: true, live: false, capturedAt: nil, names: []))
        query.text = "  holiday  "
        precondition(query.matches(video: false, live: true, capturedAt: start, names: ["IMG_001.HEIC", "Holiday-NAS.HEIC"]))
        precondition(!query.matches(video: false, live: false, capturedAt: start, names: ["different.jpg"]))
        query.from = start
        query.until = start.addingTimeInterval(100)
        precondition(!query.matches(video: false, live: true, capturedAt: nil, names: ["holiday"]))
        precondition(query.matches(video: false, live: true, capturedAt: start, names: ["holiday"]))
        precondition(!query.matches(video: false, live: true, capturedAt: query.until, names: ["holiday"]))
        query.media = .video
        precondition(!query.matches(video: false, live: true, capturedAt: start, names: ["holiday"]))
        query.media = .live
        precondition(!query.matches(video: true, live: false, capturedAt: start, names: ["holiday"]))
        query.until = start
        precondition(!query.isValid)

        var pages = XDriveIOSNativeUnifiedPageIndex(start: 0)
        // 100k results retain source checkpoints, never media rows. Re-reading
        // older windows must not append duplicates or accept changed ordering.
        for n in 0..<2_084 {
            let count = n == 2_083 ? 16 : 48
            precondition(pages.commit(page: n, count: count, next: n == 2_083 ? nil : n + 1))
        }
        precondition(pages.pages.count == 2_084)
        precondition(pages.commit(page: 12, count: 48, next: 13))
        precondition(pages.pages.count == 2_084)
        precondition(!pages.commit(page: 12, count: 47, next: 13))
        precondition(!pages.commit(page: 12, count: 48, next: 14))
        precondition(!pages.commit(page: 0, count: 48, next: 0))
        precondition(!pages.commit(page: -1, count: 1, next: nil))
        pages.measure(page: 0, height: .infinity)
        precondition(pages.pages[0].height == 160)
        pages.measure(page: 0, height: 620)
        precondition(pages.pages[0].height == 620)
        var empty = XDriveIOSNativeUnifiedPageIndex(start: 0)
        precondition(empty.commit(page: 0, count: 0, next: 192))
        precondition(empty.commit(page: 1, count: 1, next: nil))
        precondition(empty.pages.count == 2)
        print("Unified Gallery filename/date/type filtering and 100k cursor checks passed")
    }
}
