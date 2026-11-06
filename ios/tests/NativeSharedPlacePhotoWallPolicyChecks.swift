import Foundation

/// Executable, deterministic boundaries exercised without a PhotoKit database,
/// network credentials, simulator UI, or a 100k-item retained photo array.
@main
struct XDriveIOSNativeSharedPlacePhotoWallPolicyChecks {
    private static var assertions = 0

    private static func expect(_ condition: @autoclosure () -> Bool, _ name: String) {
        assertions += 1
        guard condition() else {
            fputs("shared place photo wall policy FAILED: \(name)\n", stderr)
            exit(1)
        }
    }

    private static func facet(
        _ id: String, count: Int = 3, latitude: Double = 22.3,
        revisionCoordinate: Double? = nil
    ) -> XDriveIOSNativeOwnerMapFacet {
        XDriveIOSNativeOwnerMapFacet(
            id: id, name: "verified location", latitude: revisionCoordinate ?? latitude,
            longitude: 114.1, item_count: count, cover_node_id: 1001,
            sample_latitude: 22.3, sample_longitude: 114.1,
            coordinate_kind: "grid_cell_center"
        )
    }

    static func main() {
        typealias Map = XDriveIOSNativePhotoMapPolicy
        typealias Spatial = XDriveIOSNativeLocalMapSpatialPolicy
        typealias Selection = XDriveIOSNativeOwnerMapSelectionPolicy
        typealias Anchor = XDriveIOSNativePhotoViewerReturnAnchorPolicy

        // P0-01: a sheet/Viewer return may restore only the unchanged,
        // active camera and its currently selected PhotoKit page.
        expect(Map.shouldRestoreCamera(
            savedPageOffset: 64, requestedPageOffset: 64,
            permissionGranted: true, sceneActive: true), "unchanged map camera")
        expect(!Map.shouldRestoreCamera(
            savedPageOffset: 64, requestedPageOffset: 128,
            permissionGranted: true, sceneActive: true), "changed map page")
        expect(!Map.shouldRestoreCamera(
            savedPageOffset: 64, requestedPageOffset: 64,
            permissionGranted: false, sceneActive: true), "revoked map camera")
        expect(!Map.shouldRestoreCamera(
            savedPageOffset: 64, requestedPageOffset: 64,
            permissionGranted: true, sceneActive: false), "background map camera")
        let bounds = Spatial.viewportBounds(
            latitude: 22.3, longitude: 114.1,
            latitudeSpan: 0.5, longitudeSpan: 0.5)!
        let moved = Spatial.viewportBounds(
            latitude: 23.3, longitude: 114.1,
            latitudeSpan: 0.5, longitudeSpan: 0.5)!
        expect(Spatial.matchesViewport(bounds, current: bounds), "same local camera")
        expect(!Spatial.matchesViewport(bounds, current: moved), "stale local camera")
        expect(Spatial.acceptsCellSelection(
            selectedIDs: ["grid:1:2:3"], currentCellIDs: ["grid:1:2:3"]),
            "current local cell")
        expect(!Spatial.acceptsCellSelection(
            selectedIDs: ["grid:1:2:3"], currentCellIDs: ["grid:1:2:4"]),
            "stale local cell")

        // P0-02/06: Viewer and return focus must be authorized, loaded and
        // bounded. A deleted item, permission change or evicted window fails.
        let current = (0..<48).map { "local-\($0)" }
        expect(Anchor.target("local-39", in: current, authorized: true) == "local-39",
               "local current Viewer anchor")
        expect(Anchor.target("local-39", in: current, authorized: false) == nil,
               "local revoked Viewer anchor")
        expect(Anchor.target("deleted", in: current, authorized: true) == nil,
               "local deleted Viewer item")
        expect(Anchor.localLoadedIndex(
            currentID: "local-39", in: current, authorized: true) == 39,
            "local exact loaded neighbor")
        expect(Anchor.localLoadedIndex(
            currentID: "local-39", in: current, authorized: false) == nil,
            "local disallowed neighbor")
        expect(Anchor.localNeighborID(
            currentID: "local-47", in: current, direction: 1,
            authorized: true) == nil, "no cross-place local neighbor")
        expect(Anchor.localNeighborID(
            currentID: "local-39", in: current, direction: -1,
            authorized: true) == "local-38", "same-window neighbor")

        // P0-04: validate every actual 64-slot source page and exercise
        // a synthetic 64-to-48 matching-window accumulator. Its only
        // retained pending IDs are the current 64-slot page; no 100k ID set.
        let total = 100_000
        var offset = 0
        var pending: [Int] = []
        var pendingIndex = 0
        var delivered = 0
        var maxPending = 0
        var windows = 0
        while offset < total || pendingIndex < pending.count {
            var windowCount = 0
            while windowCount < 48 {
                if pendingIndex < pending.count {
                    let selected = pending[pendingIndex]
                    pendingIndex += 1
                    expect(selected == delivered * 3,
                           "no missing or duplicated local GPS matches")
                    delivered += 1
                    windowCount += 1
                    continue
                }
                if offset >= total { break }
                let count = min(Map.pageSize, total - offset)
                let next = offset + count
                expect(Map.validPage(
                    total: total, start: offset, next: next,
                    rows: count, pins: count), "valid advancing PhotoKit page")
                expect(!Map.validPage(
                    total: total, start: offset, next: next,
                    rows: count + 1, pins: count), "reject mismatched PhotoKit rows")
                expect(!Map.validPage(
                    total: total, start: offset, next: next + 65,
                    rows: count, pins: count), "reject oversized PhotoKit page")
                pending = (offset..<next).filter { $0 % 3 == 0 }
                maxPending = max(maxPending, pending.count)
                pendingIndex = 0
                offset = next
            }
            windows += 1
            expect(windows <= total, "matching window must progress")
        }
        expect(delivered == 33_334, "all matching GPS rows across 100k slots")
        expect(maxPending <= 64, "bounded PhotoKit pending page")
        expect(offset == total, "all PhotoKit source slots consumed")

        // P0-05: canonical signed Owner facets and exact Node revisions.
        let chosen = facet("place:2230:11410")
        let changed = facet("place:2230:11410", revisionCoordinate: 22.4)
        expect(Selection.canonicalPlaceID(chosen.id), "canonical Owner place")
        expect(!Selection.canonicalPlaceID("map-region:q:0:0:1:1:0:0"),
               "aggregate cannot open cloud Range")
        expect(Selection.acceptsSelectedFacet(chosen, currentlyVisible: [chosen]),
               "signed Owner facet")
        expect(!Selection.acceptsSelectedFacet(chosen, currentlyVisible: [changed]),
               "changed Owner facet GPS")
        expect(Selection.acceptsSelectedCluster(
            [chosen, facet("place:2231:11410")],
            currentlyVisible: [chosen, facet("place:2231:11410")]),
            "exact two-place signed cluster")
        expect(!Selection.acceptsSelectedCluster(
            [chosen, changed], currentlyVisible: [chosen]),
            "reject duplicated and stale signed cluster")
        let cloud: [(id: UInt64, revision: UInt64)] = (1...48).map {
            (id: UInt64($0), revision: 5)
        }
        expect(Anchor.cloudTarget(
            lastOpenedID: 39, lastOpenedRevision: 5,
            in: cloud, ownerAuthorized: true) == 39, "same Owner and revision")
        expect(Anchor.cloudTarget(
            lastOpenedID: 39, lastOpenedRevision: 5,
            in: cloud, ownerAuthorized: false) == nil, "revoked/switched Owner")
        expect(Anchor.cloudTarget(
            lastOpenedID: 39, lastOpenedRevision: 4,
            in: cloud, ownerAuthorized: true) == nil, "stale Node revision")
        expect(Anchor.cloudTarget(
            lastOpenedID: 49, lastOpenedRevision: 5,
            in: cloud, ownerAuthorized: true) == nil, "outside cloud Range")

        // P1-08: all three bounded densities work with portrait/landscape
        // widths, but resizing is never itself a PhotoKit/Owner cursor.
        typealias Density = XDriveIOSNativePhotoWallDensity
        expect(Density.allCases == [.compact, .standard, .large], "three densities")
        for density in Density.allCases {
            expect(density.minimumCellWidth > 0, "positive tile width")
            expect(density.maximumCellWidth >= density.minimumCellWidth,
                   "bounded tile width")
            for width: CGFloat in [320, 393, 844, 1024] {
                let columns = max(1, Int((width / density.minimumCellWidth).rounded(.down)))
                expect(columns >= 1, "usable portrait/landscape tile columns")
            }
            expect(density.applyingPinch(1.05) == density, "minor scroll not zoom")
        }
        expect(Density.standard.applyingPinch(1.3) == .large, "pinch up")
        expect(Density.standard.applyingPinch(0.7) == .compact, "pinch down")
        expect(Map.compactViewport(
            width: 844, height: 390, accessibilityText: false),
            "compact landscape viewport")
        expect(!Map.compactViewport(
            width: 844, height: 390, accessibilityText: true),
            "accessibility not cramped by landscape mode")

        // P1-09: dates remain within bounded pages. A new page that begins
        // on the previous day's date does not show an extra heading.
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let t = Date(timeIntervalSince1970: 1_700_000_000)
        let days = XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: Array(repeating: t, count: 48),
            previousCapturedAt: t, hasPreviousPage: true,
            calendar: calendar)
        expect(days.count == 1 && days[0].continuesPreviousPage,
               "no duplicate day heading across a 48-window boundary")
        let newDay = XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: [t], previousCapturedAt: t.addingTimeInterval(86_400),
            hasPreviousPage: true, calendar: calendar)
        expect(newDay.count == 1 && !newDay[0].continuesPreviousPage,
               "different day receives heading")
        expect(XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: Array(repeating: t, count: 65),
            calendar: calendar).isEmpty,
            "reject unbounded grouping input")

        // P1-10: spatial map aggregates 100k GPS metadata into <=64
        // representatives, never one retained asset ID per source item.
        var index = XDriveIOSNativeLocalMapSpatialIndex<Int>()
        for i in 0..<100_000 {
            let latitude = Double((i % 12_000) - 6_000) / 100
            let longitude = Double(((i * 7) % 35_000) - 17_500) / 100
            expect(index.add(
                latitude: latitude, longitude: longitude, representative: i),
                "valid bounded spatial input")
            if i % 1_000 == 0 {
                expect(index.cells.count <= Spatial.maximumCells,
                       "bounded live map representatives")
            }
        }
        expect(index.locatedCount == 100_000, "all GPS metadata inspected")
        expect(index.cells.count <= Spatial.maximumCells,
               "spatial map remains bounded at completion")
        expect(index.cells.reduce(0) { $0 + $1.count } == 100_000,
               "no metadata lost while coarsening map cells")

        print("native shared map/gallery photo wall: \(assertions) policy checks PASS")
    }
}
