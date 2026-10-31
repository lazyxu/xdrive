import Foundation

@main
struct NativeOwnerMapSelectionPolicyChecks {
    static func main() {
        let policy = XDriveIOSNativeOwnerMapSelectionPolicy.self
        for id in ["place:0:0","place:3500:13900","place:-9000:18000",
                   "place:9000:-18000"] {
            precondition(policy.canonicalPlaceID(id), "expected canonical \(id)")
        }
        for id in ["map-region:q:-180:-90:180:90:0:0","place:03:5",
                   "place:-0:0","place:9001:0","place:0:18001",
                   "place:NaN:4","place:1:1:2","place:1.5:2",""] {
            precondition(!policy.canonicalPlaceID(id), "malformed \(id)")
        }
        func facet(_ id: String, kind: String = "grid_cell_center")
            -> XDriveIOSNativeOwnerMapFacet {
            XDriveIOSNativeOwnerMapFacet(id: id, name: "日本", latitude: 35,
                longitude: 139, item_count: 3, cover_node_id: 77,
                sample_latitude: 35, sample_longitude: 139,
                coordinate_kind: kind)
        }
        precondition(policy.canOpenPhotoRange(facet("place:3500:13900")))
        precondition(!policy.canOpenPhotoRange(facet("place:3500:13900",
                                                    kind: "map_region_sample")))
        precondition(!policy.canOpenPhotoRange(facet("map-region:q:0:0:1:1:0:0")))
        precondition(policy.acceptsSelectedPlace("place:1:2",
            currentlyVisibleIDs: ["place:1:2","place:1:3"]))
        precondition(!policy.acceptsSelectedPlace("place:1:2",
            currentlyVisibleIDs: ["place:1:3"]))
        precondition(!policy.acceptsSelectedPlace("place:1:2",
            currentlyVisibleIDs: ["place:1:2","place:1:2"]))
        let world = policy.viewportBounds(
            latitude: 0, longitude: 0, latitudeSpan: 160, longitudeSpan: 360)
        precondition(world?.west == -180 && world?.east == 180)
        let dateline = policy.viewportBounds(
            latitude: 10, longitude: 179, latitudeSpan: 2, longitudeSpan: 6)
        precondition(dateline != nil && dateline!.west > dateline!.east)
        precondition(policy.viewportBounds(
            latitude: .nan, longitude: 0, latitudeSpan: 10, longitudeSpan: 10) == nil)
        precondition(policy.viewportBounds(
            latitude: 0, longitude: 0, latitudeSpan: 0, longitudeSpan: 10) == nil)
        print("native Owner cloud MapKit place-range fence: PASS")
    }
}
