import Foundation

@main
struct NativeLocalMapSpatialPolicyChecks {
    static func main() {
        typealias Policy = XDriveIOSNativeLocalMapSpatialPolicy
        precondition(Policy.maximumCells == 64)
        precondition(Policy.key(latitude: .nan, longitude: 0, level: 0) == nil)
        precondition(Policy.key(latitude: 0, longitude: .infinity, level: 0) == nil)
        precondition(Policy.key(latitude: 91, longitude: 0, level: 0) == nil)
        precondition(Policy.key(latitude: 0, longitude: -181, level: 0) == nil)
        precondition(Policy.key(latitude: 0, longitude: 0, level: -1) == nil)
        precondition(Policy.key(latitude: 0, longitude: 0, level: 17) == nil)
        precondition(Policy.key(latitude: 90, longitude: 180, level: 0) != nil)
        precondition(Policy.key(latitude: -90, longitude: -180, level: 0) != nil)

        var same = XDriveIOSNativeLocalMapSpatialIndex<String>()
        for i in 0..<100_000 {
            precondition(same.add(latitude: 35.001, longitude: 139.001,
                                  representative: "photo-\(i)"))
        }
        precondition(same.locatedCount == 100_000 && same.cells.count == 1)
        precondition(same.cells[0].count == 100_000)
        precondition(same.cells[0].representative == "photo-0")
        precondition(same.level == 0)

        var globe = XDriveIOSNativeLocalMapSpatialIndex<Int>()
        for i in 0..<100_000 {
            let latitude = Double((i * 37) % 18000) / 100 - 90
            let longitude = Double((i * 79) % 36000) / 100 - 180
            precondition(globe.add(latitude: latitude, longitude: longitude,
                                   representative: i))
            if i % 1000 == 0 {
                precondition(globe.cells.count <= Policy.maximumCells)
            }
        }
        precondition(globe.locatedCount == 100_000)
        precondition(globe.cells.count <= Policy.maximumCells)
        precondition(globe.cells.reduce(0) { $0 + $1.count } == 100_000)
        precondition(globe.level > 0)
        precondition(Set(globe.cells.map(\.id)).count == globe.cells.count)
        precondition(globe.cells.allSatisfy {
            Policy.key(latitude: $0.latitude, longitude: $0.longitude,
                       level: globe.level) == $0.key
        })
        precondition(!globe.add(latitude: 91, longitude: 0, representative: -1))
        precondition(globe.locatedCount == 100_000)

        // Real WGS84 MapKit camera bounds, including a dateline-crossing
        // viewport. Cell membership must use the SAME bounds in overview
        // and on-demand Gallery wall so counts never widen across the border.
        let world = Policy.viewportBounds(
            latitude: 0, longitude: 0, latitudeSpan: 160, longitudeSpan: 360
        )
        precondition(world?.west == -180 && world?.east == 180)
        precondition(Policy.includes(world, latitude: 35, longitude: 179))
        precondition(!Policy.includes(world, latitude: 89, longitude: 0))
        // An almost-global camera still excludes the narrow longitude gap.
        // Exactly +/-180 are the same WGS84 meridian, even at one-sided edges.
        let nearWorld = Policy.viewportBounds(
            latitude: 0, longitude: 0, latitudeSpan: 160, longitudeSpan: 359.95
        )
        precondition(nearWorld != nil && nearWorld!.west > -180 &&
                     nearWorld!.east < 180)
        precondition(!Policy.includes(nearWorld, latitude: 0, longitude: 180))
        let eastEdge = Policy.viewportBounds(
            latitude: 0, longitude: 175, latitudeSpan: 4, longitudeSpan: 10
        )
        let westEdge = Policy.viewportBounds(
            latitude: 0, longitude: -175, latitudeSpan: 4, longitudeSpan: 10
        )
        precondition(eastEdge?.east == 180 && westEdge?.west == -180)
        precondition(Policy.includes(eastEdge, latitude: 0, longitude: -180))
        precondition(Policy.includes(westEdge, latitude: 0, longitude: 180))
        precondition(!Policy.includes(eastEdge, latitude: 0, longitude: -179))
        precondition(!Policy.includes(westEdge, latitude: 0, longitude: 179))
        let eastMeridianKey = Policy.key(latitude: 0, longitude: 180, level: 0)
        let westMeridianKey = Policy.key(latitude: 0, longitude: -180, level: 0)
        precondition(eastMeridianKey != nil && eastMeridianKey == westMeridianKey)
        var seamCells = XDriveIOSNativeLocalMapSpatialIndex<Int>()
        precondition(seamCells.add(latitude: 0, longitude: 180, representative: 1))
        precondition(seamCells.add(latitude: 0, longitude: -180, representative: 2))
        precondition(seamCells.cells.count == 1 &&
                     seamCells.cells[0].count == 2 &&
                     seamCells.locatedCount == 2)
        let dateLine = Policy.viewportBounds(
            latitude: 10, longitude: 179, latitudeSpan: 4, longitudeSpan: 8
        )
        precondition(dateLine != nil && dateLine!.west > dateLine!.east)
        precondition(Policy.includes(dateLine, latitude: 10, longitude: 179))
        precondition(Policy.includes(dateLine, latitude: 10, longitude: -179))
        precondition(!Policy.includes(dateLine, latitude: 10, longitude: 0))
        precondition(!Policy.includes(dateLine, latitude: 20, longitude: 179))
        precondition(Policy.matchesViewport(dateLine!, current: dateLine))
        let subtleMove = Policy.viewportBounds(
            latitude: 10.02, longitude: 179.05, latitudeSpan: 4, longitudeSpan: 8
        )
        precondition(Policy.matchesViewport(dateLine!, current: subtleMove))
        let movedAway = Policy.viewportBounds(
            latitude: 10, longitude: 160, latitudeSpan: 4, longitudeSpan: 8
        )
        let zoomedAway = Policy.viewportBounds(
            latitude: 10, longitude: 179, latitudeSpan: 2, longitudeSpan: 4
        )
        precondition(!Policy.matchesViewport(dateLine!, current: movedAway))
        precondition(!Policy.matchesViewport(dateLine!, current: zoomedAway))
        precondition(!Policy.matchesViewport(dateLine!, current: nil))
        precondition(!Policy.matchesViewport(
            dateLine!, current: XDriveIOSNativeLocalMapViewport(
                west: .nan, south: 8, east: -177, north: 12
            )
        ))
        precondition(Policy.viewportBounds(
            latitude: .nan, longitude: 0, latitudeSpan: 1, longitudeSpan: 1
        ) == nil)
        precondition(Policy.viewportBounds(
            latitude: 0, longitude: 0, latitudeSpan: 0, longitudeSpan: 1
        ) == nil)
        precondition(Policy.viewportBounds(
            latitude: 0, longitude: 0, latitudeSpan: 1, longitudeSpan: 361
        ) == nil)
        precondition(!Policy.includes(world, latitude: .infinity, longitude: 0))
        precondition(Policy.includes(nil, latitude: 0, longitude: 0))
        var refined = XDriveIOSNativeLocalMapSpatialIndex<Int>()
        for i in 0..<100_000 {
            let latitude = Double((i % 2000) - 1000) / 100
            let longitude = Double((i * 17) % 36000) / 100 - 180
            if Policy.includes(dateLine, latitude: latitude, longitude: longitude) {
                refined.add(latitude: latitude, longitude: longitude, representative: i)
            }
        }
        precondition(refined.cells.count <= Policy.maximumCells)
        precondition(refined.cells.reduce(0) { $0 + $1.count } == refined.locatedCount)
        precondition(refined.locatedCount > 0 && refined.locatedCount < 100_000)
        precondition(refined.cells.allSatisfy {
            Policy.includes(dateLine, latitude: $0.latitude, longitude: $0.longitude)
        })

        var two = XDriveIOSNativeLocalMapSpatialIndex<String>()
        precondition(two.add(latitude: 0, longitude: 0, representative: "first"))
        precondition(two.add(latitude: 0, longitude: 0, representative: "second"))
        precondition(two.cells.count == 1 && two.cells[0].count == 2)
        precondition(two.cells[0].representative == "first")
        print("native PhotoKit global GPS spatial policy: PASS")
    }
}
