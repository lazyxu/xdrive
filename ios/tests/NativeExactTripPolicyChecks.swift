import Foundation

@main
struct NativeExactTripPolicyChecks {
    static func main() {
        typealias P = XDriveIOSNativeExactTripPolicy
        let id = "trip:v2:2026-01-04:2026-01-05:0123456789abcdef01234567"
        let otherID = "trip:v2:2026-01-06:2026-01-07:0123456789abcdef01234567"
        precondition(P.validID(id))
        precondition(P.validTimeZone("UTC"))
        precondition(P.validTimeZone("Asia/Singapore"))
        for wrong in ["GMT", "../../etc/passwd", "Asia/Singapore%00", "Mars/Crater"] {
            precondition(!P.validTimeZone(wrong), "incorrect timezone: \(wrong)")
        }
        for invalid in [
            "trip:v1:2026-01-04:2026-01-05:0123456789abcdef01234567",
            "trip:v2:2026-01-05:2026-01-04:0123456789abcdef01234567",
            "trip:v2:2026-02-30:2026-03-01:0123456789abcdef01234567",
            "trip:v2:2026-01-04:2026-01-05:0123456789abcdef0123456G",
            "trip:v2:2026-01-04:2026-01-05:0123456789abcdef0123456",
            "map-region:q:0:0:1:1:0:0", "", "trip:v2:"
        ] {
            precondition(!P.validID(invalid), "invalid trip route admitted: \(invalid)")
        }
        let trip = XDriveIOSNativeExactTrip(
            id: id, kind: "trip", title: "地点行程", subtitle: "2 天",
            start_date: "2026-01-04", end_date: "2026-01-05",
            place_name: "地点", item_count: 97, cover_node_id: 17)
        precondition(P.validTrip(trip))
        precondition(P.validTrips([trip]))
        precondition(!P.validTrips([trip, trip]))
        precondition(!P.validTrips(Array(repeating: trip, count: 101)))

        let wrongCount = XDriveIOSNativeExactTrip(
            id: otherID, kind: "trip", title: "另一行程", subtitle: nil,
            start_date: "2026-01-06", end_date: "2026-01-07",
            place_name: nil, item_count: 0, cover_node_id: nil)
        precondition(!P.validTrip(wrongCount))
        let staleDate = XDriveIOSNativeExactTrip(
            id: id, kind: "trip", title: "地点行程", subtitle: nil,
            start_date: "2026-01-04", end_date: "2026-01-06",
            place_name: nil, item_count: 97, cover_node_id: nil)
        precondition(!P.validTrip(staleDate))

        func accepts(
            offset: Int, responseOffset: Int? = nil,
            limit: Int = 48, total: Int = 97,
            ids: [UInt64]
        ) -> Bool {
            P.validWindow(
                requestedOffset: offset, responseOffset: responseOffset ?? offset,
                responseLimit: limit, responseTotal: total,
                itemIDs: ids, expectedTotal: 97)
        }
        precondition(accepts(offset: 0, ids: Array(1...48).map(UInt64.init)))
        precondition(accepts(offset: 48, ids: Array(49...96).map(UInt64.init)))
        precondition(accepts(offset: 96, ids: [97]))
        precondition(accepts(offset: 97, ids: []) == false)
        precondition(!accepts(offset: 0, total: 98,
                              ids: Array(1...48).map(UInt64.init)))
        precondition(!accepts(offset: 0, ids: Array(1...47).map(UInt64.init)))
        precondition(!accepts(offset: 48, ids: Array(49...60).map(UInt64.init)))
        precondition(!accepts(offset: 0, responseOffset: 48,
                              ids: Array(1...48).map(UInt64.init)))
        precondition(!accepts(offset: 1, ids: Array(1...48).map(UInt64.init)))
        precondition(!accepts(offset: 48, limit: 200,
                              ids: Array(49...96).map(UInt64.init)))
        precondition(!accepts(offset: 48, ids: Array(repeating: 49, count: 48)))
        precondition(!accepts(offset: 96, ids: [0]))
        precondition(!accepts(offset: 0, ids: []))
        // A complete 2x48-member trip has no third empty page. The same
        // boundary used to pass the total equality check when count was zero.
        precondition(!P.validWindow(
            requestedOffset: 96, responseOffset: 96,
            responseLimit: 48, responseTotal: 96,
            itemIDs: [], expectedTotal: 96))
        // Synthetic 100k Owner member pagination: only the last 16 members
        // may form a short page; 48-slot windows are otherwise mandatory.
        let tailIDs = Array(99_985...100_000).map { UInt64($0) }
        precondition(P.validWindow(
            requestedOffset: 99_984, responseOffset: 99_984,
            responseLimit: 48, responseTotal: 100_000,
            itemIDs: tailIDs, expectedTotal: 100_000))
        precondition(!P.validWindow(
            requestedOffset: 99_984, responseOffset: 99_984,
            responseLimit: 48, responseTotal: 99_999,
            itemIDs: tailIDs, expectedTotal: 100_000))
        precondition(!P.validWindow(
            requestedOffset: 99_936, responseOffset: 99_936,
            responseLimit: 48, responseTotal: 100_000,
            itemIDs: tailIDs, expectedTotal: 100_000))
        print("native exact-trip policy: identity, time zone, Owner count and 48-page fences PASS")
    }
}
