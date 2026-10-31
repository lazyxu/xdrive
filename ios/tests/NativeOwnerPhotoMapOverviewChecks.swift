import Foundation

@main
struct NativeOwnerPhotoMapOverviewChecks {
    static func main() throws {
        func facet(_ id: String, count: Int = 1, lat: Double = 35.67,
                   lon: Double = 139.7, sampleLat: Double? = nil,
                   sampleLon: Double? = nil) -> XDriveIOSNativeOwnerMapFacet {
            XDriveIOSNativeOwnerMapFacet(
                id: id, name: "东京", latitude: lat, longitude: lon,
                item_count: count, cover_node_id: 42, sample_latitude: sampleLat,
                sample_longitude: sampleLon, coordinate_kind: "grid_cell_center")
        }
        func page(_ items: [XDriveIOSNativeOwnerMapFacet],
                  total: Int = 100_000) -> XDriveIOSNativeOwnerMapOverview {
            XDriveIOSNativeOwnerMapOverview(items: items, total_photo_count: total,
                                            aggregated: true)
        }
        precondition(XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(
            XDriveIOSNativeOwnerMapBounds(west: 130, south: 30, east: 146, north: 46)))
        precondition(XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(
            XDriveIOSNativeOwnerMapBounds(west: 170, south: -50, east: -170, north: 50)))
        precondition(!XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(
            XDriveIOSNativeOwnerMapBounds(west: 10, south: 40, east: 10, north: 50)))
        precondition(!XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(
            XDriveIOSNativeOwnerMapBounds(west: 10, south: 50, east: 20, north: 40)))
        precondition(!XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(
            XDriveIOSNativeOwnerMapBounds(west: .nan, south: 30, east: 40, north: 45)))
        precondition(XDriveIOSNativeOwnerMapOverviewPolicy.valid(page([], total: 0)))
        precondition(XDriveIOSNativeOwnerMapOverviewPolicy.valid(page([facet("place:1", count: 700)])))
        precondition(XDriveIOSNativeOwnerMapOverviewPolicy.valid(page(
            (1...64).map { facet("place:\($0)") })))
        precondition(!XDriveIOSNativeOwnerMapOverviewPolicy.valid(page(
            (1...65).map { facet("place:\($0)") })))
        precondition(!XDriveIOSNativeOwnerMapOverviewPolicy.valid(page([
            facet("same"), facet("same")])))
        precondition(!XDriveIOSNativeOwnerMapOverviewPolicy.valid(page([
            facet("too-many", count: 100_001)])))
        precondition(!XDriveIOSNativeOwnerMapOverviewPolicy.valid(page([
            facet("bad-gps", lat: .infinity)])))
        precondition(!XDriveIOSNativeOwnerMapOverviewPolicy.valid(page([
            facet("bad-sample", sampleLat: 30, sampleLon: nil)])))
        precondition(XDriveIOSNativeOwnerMapOverviewPolicy.valid(page([
            facet("zero-sample", sampleLat: 0, sampleLon: 0)])))
        let json = """
            {"items":[{"id":"place:1","name":"东京","latitude":35.67,
            "longitude":139.7,"item_count":12,"cover_node_id":42,
            "coordinate_kind":"grid_cell_center"}],"total_photo_count":100000,
            "aggregated":true}
            """.data(using: .utf8)!
        // Swift precondition takes a non-throwing autoclosure. Decode outside
        // of the assertion, then validate the exact decoded wire response.
        let decoded = try JSONDecoder().decode(
            XDriveIOSNativeOwnerMapOverview.self, from: json)
        precondition(XDriveIOSNativeOwnerMapOverviewPolicy.valid(decoded))
        print("native Owner WGS84 overview bounded map contract: PASS")
    }
}
