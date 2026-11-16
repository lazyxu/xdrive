import Foundation

@main
struct XDriveIOSNativeFilesViewModeChecks {
    static func require(_ ok: @autoclosure () -> Bool, _ why: String) {
        if !ok() {
            fputs("Files mode invariant failed: \(why)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesViewModePolicy
        let ids: [UInt64] = Array(1...256).map(UInt64.init)
        require(P.anchor(preferred: 111, loaded: ids) == 111, "current anchor")
        require(P.anchor(preferred: 900, loaded: ids) == 1, "evicted anchor")
        require(P.anchor(preferred: nil, loaded: ids) == 1, "cold start")
        require(P.anchor(preferred: 1, loaded: []) == nil, "no verified rows")
        require(P.anchor(preferred: 3, loaded: [1, 2, 2]) == nil, "duplicates")
        require(P.anchor(preferred: 3, loaded: [0, 3]) == nil, "zero Node")
        require(P.canRestore(ticketCurrent: true, ownerValid: true,
                pageValid: true, anchorVisible: true, screenVisible: true,
                expectedMode: "grid", currentMode: "grid", active: true),
                "same mode Owner and range")
        for denied in 0..<7 {
            require(!P.canRestore(
                ticketCurrent: denied != 0, ownerValid: denied != 1,
                pageValid: denied != 2, anchorVisible: denied != 3, screenVisible: denied != 6,
                expectedMode: "list",
                currentMode: denied == 4 ? "grid" : "list",
                active: denied != 5
            ), "reject stale ticket Owner range anchor mode inactive or hidden route")
        }
        require(abs(P.relativeAlignment(rowTop: 60, rowHeight: 60,
                                        viewportHeight: 600) - (60.0 / 540.0)) < 1e-9,
                "viewport alignment")
        require(P.relativeAlignment(rowTop: -15, rowHeight: 60,
                                    viewportHeight: 600) < 0,
                "partially visible top row")
        require(P.relativeAlignment(rowTop: .nan, rowHeight: 60,
                                    viewportHeight: 600) == 0,
                "invalid source geometry")
        require(P.relativeAlignment(rowTop: 20, rowHeight: 600,
                                    viewportHeight: 600) == 0,
                "invalid viewport size")
        print("Files List/Grid anchor checks PASS")
    }
}
