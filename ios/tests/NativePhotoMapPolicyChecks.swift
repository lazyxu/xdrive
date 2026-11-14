import Foundation

@main
struct XDriveIOSNativePhotoMapPolicyChecks {
    static func main() {
        // Short-landscape layout is shared by local and Owner-cloud MapKit.
        // Check the measured safe-area viewport, not the size-class or rotation.
        precondition(XDriveIOSNativePhotoMapPolicy.minimumInteractiveTarget >= 44)
        for viewport in [(390.0, 844.0), (844.0, 390.0),
                         (1024.0, 768.0), (507.0, 768.0), (744.0, 345.0)] {
            precondition(XDriveIOSNativePhotoMapPolicy.accessibleMapViewport(
                width: viewport.0, height: viewport.1))
        }
        for viewport in [(Double.nan, 800.0), (100.0, 0.0),
                         (20.0, 400.0), (800.0, Double.infinity)] {
            precondition(!XDriveIOSNativePhotoMapPolicy.accessibleMapViewport(
                width: viewport.0, height: viewport.1))
        }
        precondition(XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: 844, height: 360, accessibilityText: false))
        precondition(XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: 680, height: 499, accessibilityText: false))
        precondition(!XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: 679, height: 360, accessibilityText: false))
        precondition(!XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: 844, height: 500, accessibilityText: false))
        precondition(!XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: 900, height: 360, accessibilityText: true))
        precondition(!XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: 390, height: 720, accessibilityText: false))
        precondition(!XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: .nan, height: 360, accessibilityText: false))
        precondition(!XDriveIOSNativePhotoMapPolicy.compactViewport(
            width: 844, height: 0, accessibilityText: false))
        precondition(XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 0, longitude: 0))
        precondition(XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 90, longitude: -180))
        precondition(!XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 90.1, longitude: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: .nan, longitude: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 0, longitude: .infinity))
        precondition(XDriveIOSNativePhotoMapPolicy.validPage(total: 100000, start: 128, next: 192, rows: 64, pins: 53))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(total: 100000, start: 0, next: 100000, rows: 100000, pins: 64))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(total: 64, start: 0, next: 64, rows: 64, pins: 65))
        // A terminated PhotoKit page may be empty, but an unfinished
        // library must make forward progress or the map's while-loop stalls.
        precondition(XDriveIOSNativePhotoMapPolicy.validPage(
            total: 0, start: 0, next: 0, rows: 0, pins: 0))
        precondition(XDriveIOSNativePhotoMapPolicy.validPage(
            total: 64, start: 64, next: 64, rows: 0, pins: 0))
        precondition(XDriveIOSNativePhotoMapPolicy.validPage(
            total: 70, start: 64, next: 70, rows: 6, pins: 4))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(
            total: 100_000, start: 64, next: 64, rows: 0, pins: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(
            total: 64, start: 0, next: 0, rows: 0, pins: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(
            total: 70, start: 64, next: 70, rows: 0, pins: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(
            total: 64, start: 64, next: 64, rows: 0, pins: 1))
        precondition(XDriveIOSNativePhotoMapPolicy.markerLabel(27) == "当前页此位置27张照片")
        // A late MKAnnotation callback can carry an earlier 64-slot page;
        // even with active permission, it must never resurrect old photos.
        precondition(XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: ["a"], currentPageIDs: ["a", "b"]))
        precondition(XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: ["a", "b"], currentPageIDs: ["a", "b"]))
        precondition(!XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: ["stale"], currentPageIDs: ["current"]))
        precondition(!XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: ["current", "stale"], currentPageIDs: ["current"]))
        precondition(!XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: [], currentPageIDs: ["current"]))
        precondition(!XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: ["current", "current"], currentPageIDs: ["current"]))
        precondition(!XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: ["current"], currentPageIDs: ["current", "current"]))
        precondition(!XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: [""], currentPageIDs: [""]))
        precondition(!XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: ["valid"], currentPageIDs: ["valid", ""]))
        precondition(XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: ["valid"], currentPageIDs: ["valid", "other"]))
        precondition(!XDriveIOSNativePhotoMapPolicy.acceptsSelection(
            selectedIDs: Array(repeating: "x", count: 65),
            currentPageIDs: ["x"]))

        // MapKit camera return is strictly same-page; switching the PhotoKit
        // window, losing access or backgrounding must drop saved camera.
        precondition(XDriveIOSNativePhotoMapPolicy.shouldRestoreCamera(
            savedPageOffset: 128, requestedPageOffset: 128,
            permissionGranted: true, sceneActive: true))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldRestoreCamera(
            savedPageOffset: nil, requestedPageOffset: 128,
            permissionGranted: true, sceneActive: true))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldRestoreCamera(
            savedPageOffset: 128, requestedPageOffset: 192,
            permissionGranted: true, sceneActive: true))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldRestoreCamera(
            savedPageOffset: 128, requestedPageOffset: 128,
            permissionGranted: false, sceneActive: true))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldRestoreCamera(
            savedPageOffset: 128, requestedPageOffset: 128,
            permissionGranted: true, sceneActive: false))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldRestoreCamera(
            savedPageOffset: -1, requestedPageOffset: 0,
            permissionGranted: true, sceneActive: true))
        // Forward find operates on one PhotoKit snapshot, stops on the
        // first GPS hit, end of the library, or <=1,024 scanned slots.
        precondition(XDriveIOSNativePhotoMapPolicy.shouldSeekNextGPSPage(
            foundPins: 0, finished: false, pagesRead: 1))
        precondition(XDriveIOSNativePhotoMapPolicy.shouldSeekNextGPSPage(
            foundPins: 0, finished: false, pagesRead: 15))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldSeekNextGPSPage(
            foundPins: 1, finished: false, pagesRead: 1))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldSeekNextGPSPage(
            foundPins: 0, finished: true, pagesRead: 1))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldSeekNextGPSPage(
            foundPins: 0, finished: false, pagesRead: 16))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldSeekNextGPSPage(
            foundPins: 0, finished: false, pagesRead: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.shouldSeekNextGPSPage(
            foundPins: 0, finished: false, pagesRead: -1))
        precondition(XDriveIOSNativePhotoMapPolicy.maxSeekGPSPages *
            XDriveIOSNativePhotoMapPolicy.pageSize == 1024)
        // Same absolute instants must drive PhotoKit and Owner map/photo Ranges.
        // London advances the clock in spring and repeats an hour in autumn.
        var london = Calendar(identifier: .gregorian)
        london.timeZone = TimeZone(identifier: "Europe/London")!
        let spring = XDriveIOSNativePhotoMapCaptureRange.dayKey(
            "2026-3-29", calendar: london)!
        let autumn = XDriveIOSNativePhotoMapCaptureRange.dayKey(
            "2026-10-25", calendar: london)!
        precondition(spring.valid && autumn.valid)
        precondition(spring.to.timeIntervalSince(spring.from) == 23 * 3600)
        precondition(autumn.to.timeIntervalSince(autumn.from) == 25 * 3600)
        precondition(spring.contains(spring.from))
        precondition(!spring.contains(spring.to))
        precondition(!spring.contains(nil))
        precondition(!autumn.contains(spring.from))
        precondition(XDriveIOSNativePhotoMapCaptureRange.year(
            2026, calendar: london)!.contains(autumn.from))
        precondition(XDriveIOSNativePhotoMapCaptureRange.year(
            2025, calendar: london)!.contains(autumn.from) == false)
        precondition(XDriveIOSNativePhotoMapCaptureRange.dayKey(
            "2026-2-30", calendar: london) == nil)
        precondition(XDriveIOSNativePhotoMapCaptureRange.dayKey(
            "unknown", calendar: london) == nil)
        precondition(XDriveIOSNativePhotoMapCaptureRange.recentDays(
            366, now: autumn.from, calendar: london) != nil)
        precondition(XDriveIOSNativePhotoMapCaptureRange.recentDays(
            367, now: autumn.from, calendar: london) == nil)
        precondition(spring.fromRFC3339.hasSuffix("Z"))
        precondition(spring.toRFC3339.hasSuffix("Z"))
                print("native iOS PhotoKit map policy: PASS")
    }
}
