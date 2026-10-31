import Foundation

/// Only exact server-original GPS cell identities may request PhotoAsset Range.
/// Aggregated "map-region" IDs are presentation-only and must be zoomed first.
enum XDriveIOSNativeOwnerMapSelectionPolicy {
    static func canonicalPlaceID(_ value: String) -> Bool {
        guard value.utf8.count <= 64 else { return false }
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "place",
              let lat = Int(parts[1]), let lon = Int(parts[2]),
              (-9000...9000).contains(lat), (-18000...18000).contains(lon)
        else { return false }
        return value == "place:\(lat):\(lon)"
    }

    static func canOpenPhotoRange(_ facet: XDriveIOSNativeOwnerMapFacet) -> Bool {
        canonicalPlaceID(facet.id) &&
        facet.coordinate_kind != "map_region_sample" &&
        facet.item_count > 0
    }

    /// Never promote an SDK- or annotation-provided identity. Caller checks
    /// membership against the current verified Owner overview at tap time.
    static func acceptsSelectedPlace(
        _ id: String, currentlyVisibleIDs: [String]
    ) -> Bool {
        !currentlyVisibleIDs.isEmpty && currentlyVisibleIDs.count <= 64 &&
        Set(currentlyVisibleIDs).count == currentlyVisibleIDs.count &&
        canonicalPlaceID(id) && currentlyVisibleIDs.contains(id)
    }

    /// Camera movement revokes the click authority of the previous signed
    /// Owner overview, even if its pins remain visible as inert map markers.
    /// Never use a previous WGS84 viewport as a fresh PhotoAsset Range scope.
    static func isSameViewport(
        _ authorized: XDriveIOSNativeOwnerMapBounds,
        current: XDriveIOSNativeOwnerMapBounds?
    ) -> Bool {
        guard let current,
              XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(authorized),
              XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(current)
        else { return false }
        return authorized == current
    }

    /// Choose a bounded number of canonical Owner GPS places for visual
    /// photo covers. Keep SDK/aggregate identities out of the photo Reader,
    /// prioritize the actual signed photo count, and reject duplicates.
    static let maximumPhotoCovers = 12

    static func prioritizedPhotoCovers(
        _ places: [XDriveIOSNativeOwnerMapFacet]
    ) -> [XDriveIOSNativeOwnerMapFacet] {
        guard places.count <= XDriveIOSNativeOwnerMapOverviewPolicy.maximumCells else {
            return []
        }
        let ids = places.map(\.id)
        guard Set(ids).count == ids.count else { return [] }
        return Array(places.filter { canOpenPhotoRange($0) }
            .sorted {
                if $0.item_count != $1.item_count {
                    return $0.item_count > $1.item_count
                }
                return $0.id < $1.id
            }.prefix(maximumPhotoCovers))
    }

    /// Request WGS84 bounds directly from MapKit's current camera, never BD09.
    /// Full world is explicit; west > east denotes antimeridian crossing.
    static func viewportBounds(
        latitude: Double, longitude: Double,
        latitudeSpan: Double, longitudeSpan: Double
    ) -> XDriveIOSNativeOwnerMapBounds? {
        guard latitude.isFinite && abs(latitude) <= 90,
              longitude.isFinite && abs(longitude) <= 180,
              latitudeSpan.isFinite && latitudeSpan > 0 && latitudeSpan <= 180,
              longitudeSpan.isFinite && longitudeSpan > 0 && longitudeSpan <= 360 else {
            return nil
        }
        let south = max(-90.0, latitude - latitudeSpan / 2)
        let north = min(90.0, latitude + latitudeSpan / 2)
        guard south < north else { return nil }
        if longitudeSpan >= 359.9 {
            return XDriveIOSNativeOwnerMapBounds(west: -180, south: south,
                                                 east: 180, north: north)
        }
        func normalized(_ value: Double) -> Double {
            var wrapped = value.truncatingRemainder(dividingBy: 360)
            if wrapped > 180 { wrapped -= 360 }
            if wrapped < -180 { wrapped += 360 }
            return wrapped
        }
        let west = normalized(longitude - longitudeSpan / 2)
        let east = normalized(longitude + longitudeSpan / 2)
        let bounds = XDriveIOSNativeOwnerMapBounds(
            west: west, south: south, east: east, north: north
        )
        return XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(bounds) ? bounds : nil
    }
}
