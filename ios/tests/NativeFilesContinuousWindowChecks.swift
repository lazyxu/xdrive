import Foundation

@main
struct XDriveIOSNativeFilesContinuousWindowChecks {
    static func require(_ ok: @autoclosure () -> Bool, _ description: String) {
        if !ok() {
            fputs("iOS Files continuous window failed: \(description)\n", stderr)
            exit(1)
        }
    }

    static func ids(_ a: Int, _ b: Int) -> [UInt64] {
        (a..<b).map { UInt64($0 + 1) }
    }

    static func main() {
        typealias Window = XDriveIOSNativeFilesContinuousWindowPolicy
        require(Window.requestedOffset(direction: .next, startOffset: 0,
                                       loadedCount: 64, total: 100_000) == 64,
                "initial next range")
        require(Window.requestedOffset(direction: .previous, startOffset: 0,
                                       loadedCount: 64, total: 100_000) == nil,
                "no range before root")
        require(Window.mergePlan(direction: .next, startOffset: 0,
                                 currentIDs: ids(0, 64), incomingIDs: ids(64, 128),
                                 pageOffset: 64, total: 100_000,
                                 returnedTotal: 100_000) ==
                Window.MergePlan(startOffset: 0, dropFromFront: 0, dropFromBack: 0),
                "append verified range")
        require(Window.mergePlan(direction: .next, startOffset: 0,
                                 currentIDs: ids(0, 256), incomingIDs: ids(256, 320),
                                 pageOffset: 256, total: 100_000,
                                 returnedTotal: 100_000) ==
                Window.MergePlan(startOffset: 64, dropFromFront: 64, dropFromBack: 0),
                "forward window slide remains bounded")
        require(Window.mergePlan(direction: .previous, startOffset: 64,
                                 currentIDs: ids(64, 320), incomingIDs: ids(0, 64),
                                 pageOffset: 0, total: 100_000,
                                 returnedTotal: 100_000) ==
                Window.MergePlan(startOffset: 0, dropFromFront: 0, dropFromBack: 64),
                "reverse window slide remains bounded")
        require(Window.mergePlan(direction: .previous, startOffset: 128,
                                 currentIDs: ids(128, 328), incomingIDs: ids(64, 128),
                                 pageOffset: 64, total: 328,
                                 returnedTotal: 328) ==
                Window.MergePlan(startOffset: 64, dropFromFront: 0, dropFromBack: 8),
                "reverse from partial last page retires short suffix")
        require(Window.requestedOffset(direction: .next, startOffset: 64,
                                       loadedCount: 256, total: 328) == 320,
                "next offset after reverse trimming remains aligned")
        require(Window.requestedOffset(direction: .next, startOffset: 256,
                                       loadedCount: 8, total: 264) == nil,
                "stop at the final range")
        require(Window.mergePlan(direction: .next, startOffset: 0,
                                 currentIDs: ids(0, 64), incomingIDs: ids(63, 127),
                                 pageOffset: 64, total: 100_000,
                                 returnedTotal: 100_000) == nil,
                "reject repeated Node identity across ranges")
        require(Window.mergePlan(direction: .next, startOffset: 0,
                                 currentIDs: ids(0, 64), incomingIDs: ids(64, 128),
                                 pageOffset: 64, total: 100_000,
                                 returnedTotal: 100_001) == nil,
                "reject changed total")
        require(Window.mergePlan(direction: .next, startOffset: 0,
                                 currentIDs: ids(0, 64), incomingIDs: ids(64, 80),
                                 pageOffset: 64, total: 100_000,
                                 returnedTotal: 100_000) == nil,
                "reject short nonterminal range")
        require(Window.mergePlan(direction: .next, startOffset: 0,
                                 currentIDs: ids(0, 64), incomingIDs: ids(64, 128),
                                 pageOffset: 128, total: 100_000,
                                 returnedTotal: 100_000) == nil,
                "reject shifted range")
        require(Window.requestedOffset(direction: .next, startOffset: 1,
                                       loadedCount: 64, total: 100_000) == nil,
                "reject unaligned range")
        // Returning from a child folder or clearing global search must
        // preserve a verified 64-entry page and the actual visible Node.
        let middle = ids(64, 320)
        require(Window.restoreAnchor(
            lastAppearedNodeID: middle[130], startOffset: 64,
            loadedIDs: middle, total: 100_000
        ) == Window.RestoreAnchor(nodeID: middle[130], pageOffset: 192),
                "return to a row inside a four-range sliding window")
        let terminal = ids(128, 328)
        require(Window.restoreAnchor(
            lastAppearedNodeID: terminal.last, startOffset: 128,
            loadedIDs: terminal, total: 328
        ) == Window.RestoreAnchor(nodeID: 328, pageOffset: 320),
                "return to a partial final page")
        require(Window.restoreAnchor(
            lastAppearedNodeID: 500, startOffset: 64,
            loadedIDs: middle, total: 100_000
        ) == nil, "do not restore an evicted Node")
        require(Window.restoreAnchor(
            lastAppearedNodeID: middle[10], startOffset: 7,
            loadedIDs: middle, total: 100_000
        ) == nil, "reject misaligned prior window")
        require(Window.restoreAnchor(
            lastAppearedNodeID: 40, startOffset: 0,
            loadedIDs: ids(0, 40), total: 100_000
        ) == nil, "reject a short nonterminal window")
        require(Window.restoreAnchor(
            lastAppearedNodeID: 63, startOffset: 0,
            loadedIDs: ids(0, 63) + [63], total: 100_000
        ) == nil, "reject duplicate Node IDs")
        require(Window.restoreAnchor(
            lastAppearedNodeID: 320, startOffset: 0,
            loadedIDs: ids(0, 320), total: 100_000
        ) == nil, "reject more than four loaded ranges")
        require(Window.restoreAnchor(
            lastAppearedNodeID: 0, startOffset: 0,
            loadedIDs: ids(0, 64), total: 100_000
        ) == nil, "reject zero Node identity")
        print("iOS Files bounded continuous scrolling policy passed")
    }
}
