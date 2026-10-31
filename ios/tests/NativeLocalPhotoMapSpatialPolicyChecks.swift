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

        var two = XDriveIOSNativeLocalMapSpatialIndex<String>()
        precondition(two.add(latitude: 0, longitude: 0, representative: "first"))
        precondition(two.add(latitude: 0, longitude: 0, representative: "second"))
        precondition(two.cells.count == 1 && two.cells[0].count == 2)
        precondition(two.cells[0].representative == "first")
        print("native PhotoKit global GPS spatial policy: PASS")
    }
}
