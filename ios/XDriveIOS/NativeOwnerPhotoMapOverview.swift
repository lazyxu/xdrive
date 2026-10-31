import Foundation

/// Server Owner-scoped WGS84 map cells, not raw PhotoKit assets or BD09.
struct XDriveIOSNativeOwnerMapBounds: Equatable {
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
}

struct XDriveIOSNativeOwnerMapOverview: Decodable {
    let items: [XDriveIOSNativeOwnerMapFacet]
    let total_photo_count: Int
    let aggregated: Bool
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
            if let lat = item.sample_latitude, let lon = item.sample_longitude {
                guard lat.isFinite && lon.isFinite && abs(lat) <= 90 && abs(lon) <= 180
                else { return false }
            } else if item.sample_latitude != nil || item.sample_longitude != nil {
                return false
            }
        }
        return true
    }
}
