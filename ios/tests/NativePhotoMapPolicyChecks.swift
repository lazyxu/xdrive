import Foundation

@main
struct XDriveIOSNativePhotoMapPolicyChecks {
    static func main() {
        precondition(XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 0, longitude: 0))
        precondition(XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 90, longitude: -180))
        precondition(!XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 90.1, longitude: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: .nan, longitude: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 0, longitude: .infinity))
        precondition(XDriveIOSNativePhotoMapPolicy.validPage(total: 100000, start: 128, next: 192, rows: 64, pins: 53))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(total: 100000, start: 0, next: 100000, rows: 100000, pins: 64))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(total: 64, start: 0, next: 64, rows: 64, pins: 65))
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
        print("native iOS PhotoKit map policy: PASS")
    }
}
