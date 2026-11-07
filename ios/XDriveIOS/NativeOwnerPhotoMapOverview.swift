import Foundation

/// Server Owner-scoped WGS84 map cells, not raw PhotoKit assets or BD09.
struct XDriveIOSNativeOwnerMapBounds: Equatable, Decodable {
    let west: Double
    let south: Double
    let east: Double
    let north: Double
}

struct XDriveIOSNativeOwnerMapFacet: Decodable, Identifiable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double
    let item_count: Int
    let cover_node_id: UInt64?
    let sample_latitude: Double?
    let sample_longitude: Double?
    let coordinate_kind: String?
    let display_bounds: XDriveIOSNativeOwnerMapBounds?

    init(id: String, name: String, latitude: Double, longitude: Double,
         item_count: Int, cover_node_id: UInt64?, sample_latitude: Double?,
         sample_longitude: Double?, coordinate_kind: String?,
         display_bounds: XDriveIOSNativeOwnerMapBounds? = nil) {
        self.id = id
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.item_count = item_count
        self.cover_node_id = cover_node_id
        self.sample_latitude = sample_latitude
        self.sample_longitude = sample_longitude
        self.coordinate_kind = coordinate_kind
        self.display_bounds = display_bounds
    }
}

struct XDriveIOSNativeOwnerMapOverview: Decodable {
    let items: [XDriveIOSNativeOwnerMapFacet]
    let total_photo_count: Int
    let trip_photo_count: Int?
    let aggregated: Bool

    // Keep non-trip DTO construction source-compatible while trip responses
    // carry an independently authenticated full-trip count.
    init(items: [XDriveIOSNativeOwnerMapFacet], total_photo_count: Int,
         aggregated: Bool, trip_photo_count: Int? = nil) {
        self.items = items
        self.total_photo_count = total_photo_count
        self.trip_photo_count = trip_photo_count
        self.aggregated = aggregated
    }
}

/// Never mistake an aggregate cell center for the representative photo's GPS.
/// The caller additionally requires its existing verified Owner/HTTPS Reader.
enum XDriveIOSNativeOwnerMapOverviewPolicy {
    static let maximumCells = 64
    static let maximumBytes = 2 * 1_048_576

    static func validBounds(_ b: XDriveIOSNativeOwnerMapBounds) -> Bool {
        b.west.isFinite && b.east.isFinite &&
        b.south.isFinite && b.north.isFinite &&
        abs(b.west) <= 180 && abs(b.east) <= 180 &&
        abs(b.south) <= 90 && abs(b.north) <= 90 &&
        b.south < b.north && b.west != b.east
        // West > East crosses the antimeridian; it is valid.
    }

    static func valid(_ overview: XDriveIOSNativeOwnerMapOverview) -> Bool {
        guard overview.items.count <= maximumCells,
              (0...100_000_000).contains(overview.total_photo_count) else { return false }
        var identities = Set<String>()
        var summedPhotoCount = 0
        for item in overview.items {
            guard !item.id.isEmpty, item.id.utf8.count <= 256,
                  identities.insert(item.id).inserted,
                  !item.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  item.name.utf8.count <= 256,
                  item.item_count > 0 && item.item_count <= overview.total_photo_count,
                  item.latitude.isFinite && abs(item.latitude) <= 90,
                  item.longitude.isFinite && abs(item.longitude) <= 180,
                  (item.cover_node_id == nil || item.cover_node_id! > 0),
                  (item.coordinate_kind == nil ||
                    item.coordinate_kind == "grid_cell_center" ||
                    item.coordinate_kind == "map_region_sample")
            else { return false }
            if let bounds = item.display_bounds {
                guard item.coordinate_kind == "map_region_sample" &&
                    validBounds(bounds) else { return false }
            }
            if let lat = item.sample_latitude, let lon = item.sample_longitude {
                guard lat.isFinite && lon.isFinite && abs(lat) <= 90 && abs(lon) <= 180
                else { return false }
            } else if item.sample_latitude != nil || item.sample_longitude != nil {
                return false
            }
            // Server exact-place pages and aggregate 8x8 buckets partition
            // one Owner/viewport selection. Their disjoint item counts must
            // add up to the same authenticated total, never overlap or omit
            // photos. Reject a changed/non-atomic snapshot rather than
            // rendering a misleading count or cover.
            let (next, overflow) = summedPhotoCount.addingReportingOverflow(item.item_count)
            guard !overflow && next <= overview.total_photo_count else { return false }
            summedPhotoCount = next
        }
        return summedPhotoCount == overview.total_photo_count
    }
}
