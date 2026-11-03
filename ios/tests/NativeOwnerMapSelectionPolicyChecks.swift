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
        func facet(_ id: String, kind: String = "grid_cell_center",
                   count: Int = 3) -> XDriveIOSNativeOwnerMapFacet {
            XDriveIOSNativeOwnerMapFacet(id: id, name: "日本", latitude: 35,
                longitude: 139, item_count: count, cover_node_id: 77,
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
        let cloudPicked = [
            facet("place:3500:13900", count: 2),
            facet("place:3500:13901", count: 4)
        ]
        let signedPlaces = cloudPicked + [facet("place:3500:13902", count: 1)]
        precondition(policy.acceptsSelectedCluster(
            cloudPicked, currentlyVisible: signedPlaces))
        precondition(!policy.acceptsSelectedCluster(
            [cloudPicked[0]], currentlyVisible: signedPlaces))
        precondition(!policy.acceptsSelectedCluster(
            cloudPicked + [cloudPicked[0]], currentlyVisible: signedPlaces))
        precondition(!policy.acceptsSelectedCluster(
            cloudPicked, currentlyVisible: [cloudPicked[0]]))
        precondition(!policy.acceptsSelectedCluster(
            [cloudPicked[0], facet("place:3500:13901", count: 5)],
            currentlyVisible: signedPlaces))
        precondition(!policy.acceptsSelectedCluster(
            [cloudPicked[0], facet("map-region:q:0:0:1:1:0:0",
                                   kind: "map_region_sample", count: 5)],
            currentlyVisible: signedPlaces))
        let world = policy.viewportBounds(
            latitude: 0, longitude: 0, latitudeSpan: 160, longitudeSpan: 360)
        precondition(world?.west == -180 && world?.east == 180)
        // A nearly global viewport must not broaden the Owner's signed GPS
        // camera scope to include unseen locations across the small gap.
        let nearWorld = policy.viewportBounds(
            latitude: 0, longitude: 0, latitudeSpan: 160, longitudeSpan: 359.95)
        precondition(nearWorld != nil && nearWorld!.west > -180 &&
                     nearWorld!.east < 180)
        precondition(!policy.isSameViewport(world!, current: nearWorld))
        // Longitude wrapping remains valid when that narrow gap straddles
        // the prime meridian instead of the antimeridian.
        let wrappedNearWorld = policy.viewportBounds(
            latitude: 0, longitude: 179.95,
            latitudeSpan: 160, longitudeSpan: 359.95)
        precondition(wrappedNearWorld != nil &&
                     wrappedNearWorld!.west > wrappedNearWorld!.east)

        let dateline = policy.viewportBounds(
            latitude: 10, longitude: 179, latitudeSpan: 2, longitudeSpan: 6)
        precondition(dateline != nil && dateline!.west > dateline!.east)
        precondition(policy.viewportBounds(
            latitude: .nan, longitude: 0, latitudeSpan: 10, longitudeSpan: 10) == nil)
        precondition(policy.viewportBounds(
            latitude: 0, longitude: 0, latitudeSpan: 0, longitudeSpan: 10) == nil)
        // Same viewport can publish a newly signed overview; a moved camera
        // cannot promote the old response or open an old pin as a new Range.
        precondition(world != nil && policy.isSameViewport(world!, current: world))
        precondition(!policy.isSameViewport(world!, current: nil))
        let shiftedWorld = policy.viewportBounds(
            latitude: 1, longitude: 0, latitudeSpan: 160, longitudeSpan: 360)
        precondition(!policy.isSameViewport(world!, current: shiftedWorld))
        precondition(dateline != nil && policy.isSameViewport(dateline!, current: dateline))
        precondition(!policy.isSameViewport(dateline!, current: world))
        // Executed Swift policy proof: 64 authenticated candidates keep
        // all 64 count-prioritized exact places with deterministic ties.
        let candidates = (0..<64).map {
            facet("place:10:\($0)", count: $0 + 1)
        }
        precondition(policy.maximumPhotoCovers ==
                     XDriveIOSNativeOwnerMapOverviewPolicy.maximumCells)
        let covers = policy.prioritizedPhotoCovers(Array(candidates.reversed()))
        precondition(covers.count == policy.maximumPhotoCovers)
        precondition(covers.map(\.item_count) == Array((1...64).reversed()))
        precondition(covers.first?.id == "place:10:63")
        let ties = policy.prioritizedPhotoCovers([
            facet("place:10:2", count: 5),
            facet("place:10:1", count: 5),
            facet("place:10:0", count: 5)
        ])
        precondition(ties.map(\.id) == ["place:10:0", "place:10:1", "place:10:2"])
        let mixed = policy.prioritizedPhotoCovers([
            facet("map-region:q:0:0:1:1:0:0", kind: "map_region_sample", count: 99),
            facet("place:10:5", count: 2)
        ])
        precondition(mixed.map(\.id) == ["place:10:5"])
        precondition(policy.prioritizedPhotoCovers([
            facet("place:10:1"), facet("place:10:1")
        ]).isEmpty)
        precondition(policy.prioritizedPhotoCovers(
            (0..<65).map { facet("place:10:\($0)") }
        ).isEmpty)
        print("native Owner cloud MapKit place-range fence: PASS")
    }
}
