import Foundation

/// A Server-proven v2 trip candidate, never the older date-only Memories trip.
/// IDs encode only an Owner-scoped calendar/geography selector; they are not
/// authentication tokens and cannot grant access to media.
struct XDriveIOSNativeExactTrip: Decodable, Identifiable {
    let id: String
    let kind: String
    let title: String
    let subtitle: String?
    let start_date: String
    let end_date: String
    let place_name: String?
    let item_count: Int
    let cover_node_id: UInt64?
}

/// The native app must not turn a dated heuristic into a trusted Owner Range.
/// The Reader re-verifies authorization separately for each network request.
enum XDriveIOSNativeExactTripPolicy {
    static let maximumTrips = 100
    static let maximumMediaCount = 10_000_000
    static let pageSize = 48

    static func validTimeZone(_ zone: String) -> Bool {
        zone == "UTC" ||
            (zone.utf8.count <= 80 && zone.contains("/") &&
             zone.utf8.allSatisfy {
                 (65...90).contains($0) || (97...122).contains($0) ||
                 (48...57).contains($0) || $0 == 47 || $0 == 95 ||
                 $0 == 43 || $0 == 45
             } && TimeZone(identifier: zone) != nil)
    }

    private static func validDate(_ value: String) -> Bool {
        guard value.utf8.count == 10 else { return false }
        let format = DateFormatter()
        format.calendar = Calendar(identifier: .gregorian)
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = TimeZone(secondsFromGMT: 0)
        format.dateFormat = "yyyy-MM-dd"
        format.isLenient = false
        guard let date = format.date(from: value) else { return false }
        return format.string(from: date) == value
    }

    static func validID(_ id: String) -> Bool {
        // trip:v2:YYYY-MM-DD:YYYY-MM-DD:<24 lowercase hex>
        guard id.utf8.count == 54 else { return false }
        let parts = id.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 5, parts[0] == "trip", parts[1] == "v2",
              validDate(String(parts[2])), validDate(String(parts[3])),
              parts[2] <= parts[3], parts[4].utf8.count == 24
        else { return false }
        return parts[4].utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }

    static func validTrip(_ trip: XDriveIOSNativeExactTrip) -> Bool {
        guard validID(trip.id), trip.kind == "trip",
              (1...maximumMediaCount).contains(trip.item_count),
              !trip.title.isEmpty, trip.title.utf8.count <= 256,
              (trip.subtitle?.utf8.count ?? 0) <= 512,
              (trip.place_name?.utf8.count ?? 0) <= 256,
              (trip.cover_node_id ?? 1) > 0
        else { return false }
        let parts = trip.id.split(separator: ":")
        return trip.start_date == String(parts[2]) &&
            trip.end_date == String(parts[3])
    }

    static func validTrips(_ trips: [XDriveIOSNativeExactTrip]) -> Bool {
        trips.count <= maximumTrips &&
            trips.allSatisfy(validTrip) &&
            Set(trips.map(\.id)).count == trips.count
    }

    static func validWindow(
        requestedOffset: Int, responseOffset: Int,
        responseLimit: Int, responseTotal: Int,
        itemIDs: [UInt64], expectedTotal: Int
    ) -> Bool {
        // Count changes must force reloading the v2 trip list. Never let a
        // stale map select a newer Owner range just by keeping the same ID.
        guard expectedTotal > 0, expectedTotal <= maximumMediaCount,
              responseTotal == expectedTotal,
              requestedOffset >= 0,
              requestedOffset % pageSize == 0,
              requestedOffset < responseTotal,
              responseOffset == requestedOffset,
              responseLimit == pageSize,
              itemIDs.count <= pageSize,
              responseOffset + itemIDs.count <= responseTotal,
              !(itemIDs.isEmpty && responseOffset < responseTotal),
              (responseOffset + itemIDs.count == responseTotal ||
               itemIDs.count == pageSize),
              Set(itemIDs).count == itemIDs.count
        else { return false }
        return itemIDs.allSatisfy { $0 > 0 }
    }
}
