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
        print("iOS Files bounded continuous scrolling policy passed")
    }
}
