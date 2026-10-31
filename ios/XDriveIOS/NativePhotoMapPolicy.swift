import Foundation

/// One currently scanned PhotoKit page, not a spatial index of 100k media.
enum XDriveIOSNativePhotoMapPolicy {
    static let pageSize = 64

    static func validCoordinate(latitude: Double, longitude: Double) -> Bool {
        latitude.isFinite && longitude.isFinite &&
        abs(latitude) <= 90 && abs(longitude) <= 180
    }

    static func validPage(total: Int, start: Int, next: Int, rows: Int, pins: Int) -> Bool {
        total >= 0 && start >= 0 && start <= next && next <= total &&
        next - start <= pageSize && rows == next - start &&
        pins >= 0 && pins <= rows
    }

    /// A delayed MapKit didSelect must never reopen a photo from the old
    /// 64-slot page after a page change, revoke or reload. The caller reads
    /// the currently mounted PhotoKit State page at selection time; this
    /// check accepts only distinct, nonempty members of that exact page.
    static func acceptsSelection(
        selectedIDs: [String], currentPageIDs: [String]
    ) -> Bool {
        guard !selectedIDs.isEmpty, selectedIDs.count <= pageSize,
              currentPageIDs.count <= pageSize else { return false }
        let selectedSet = Set(selectedIDs)
        let pageSet = Set(currentPageIDs)
        return selectedSet.count == selectedIDs.count &&
            pageSet.count == currentPageIDs.count &&
            !selectedSet.contains("") && selectedSet.isSubset(of: pageSet)
    }

    /// A Viewer return may reuse its source PhotoKit page camera only while
    /// that very page is still authorized and active. Never carry a camera
    /// from a previous page, revoked PhotoKit subset or background scene.
    static func shouldRestoreCamera(
        savedPageOffset: Int?,
        requestedPageOffset: Int,
        permissionGranted: Bool,
        sceneActive: Bool
    ) -> Bool {
        guard let savedPageOffset, savedPageOffset >= 0,
              requestedPageOffset >= 0 else { return false }
        return permissionGranted && sceneActive &&
            savedPageOffset == requestedPageOffset
    }

    // Each explicit "find GPS" action scans at most 16 consecutive
    // PhotoKit pages (16 * 64 = 1,024 metadata slots). Empty pages do not
    // silently imply there are no valid GPS assets in the full library.
    static let maxSeekGPSPages = 16

    static func shouldSeekNextGPSPage(
        foundPins: Int, finished: Bool, pagesRead: Int
    ) -> Bool {
        foundPins == 0 && !finished &&
        pagesRead >= 1 && pagesRead < maxSeekGPSPages
    }

    static func markerLabel(_ count: Int) -> String {
        "当前页此位置\(max(0, min(pageSize, count)))张照片"
    }
}
