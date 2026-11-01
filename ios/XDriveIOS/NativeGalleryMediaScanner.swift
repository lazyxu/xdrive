import Foundation
import Photos

/// Dedicated to read-only native Gallery filtering; the backup scanner and
/// persistent upload cursors do not change.
private final class XDriveIOSNativeGalleryMediaChangeObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let lock = NSLock()
    private var revision: UInt64 = 0
    func current() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return revision
    }
    func photoLibraryDidChange(_ changeInstance: PHChange) {
        lock.lock()
        revision &+= 1
        lock.unlock()
    }
}

/// One lazy PHFetchResult and one 64-slot page per visible virtual page.
/// A media type comes from PhotoKit's real filtered fetch, not post-filtering
/// a page of all assets (which would skip older videos).
actor XDriveIOSNativeGalleryMediaScanner {
    private let observer = XDriveIOSNativeGalleryMediaChangeObserver()
    private var listening = false
    private var snapshot: PHFetchResult<PHAsset>?
    private var permission: PHAuthorizationStatus?
    private var version: UInt64 = 0
    private var filter: XDriveIOSNativePhotoMediaFilter = .all
    private var nextOffset = 0

    deinit {
        if listening { PHPhotoLibrary.shared().unregisterChangeObserver(observer) }
    }

    func start(atOffset requestedOffset: Int = 0,
               mediaFilter: XDriveIOSNativePhotoMediaFilter) throws -> Int {
        reset()
        guard requestedOffset >= 0 else { throw XDrivePhotoKitScanFailure.invalidOffset }
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard current == .authorized || current == .limited else {
            throw XDrivePhotoKitScanFailure.notAuthorized
        }
        PHPhotoLibrary.shared().register(observer)
        listening = true
        let revision = observer.current()
        let options = PHFetchOptions()
        options.sortDescriptors = [
            NSSortDescriptor(key: "creationDate", ascending: false),
            NSSortDescriptor(key: "localIdentifier", ascending: true)
        ]
        let result: PHFetchResult<PHAsset>
        switch mediaFilter {
        case .all:
            result = PHAsset.fetchAssets(with: options)
        case .photos:
            result = PHAsset.fetchAssets(with: .image, options: options)
        case .videos:
            result = PHAsset.fetchAssets(with: .video, options: options)
        }
        guard observer.current() == revision,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == current else {
            reset()
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        snapshot = result
        permission = current
        version = revision
        filter = mediaFilter
        nextOffset = min(requestedOffset, result.count)
        return result.count
    }

    func nextPage() throws -> XDrivePhotoKitScanPage {
        guard let snapshot, let permission else {
            throw XDrivePhotoKitScanFailure.notStarted
        }
        try ensureCurrent(permission)
        try Task.checkCancellation()
        let start = nextOffset
        let end = min(snapshot.count, start + 64)
        var items: [XDrivePhotoKitScanCandidate] = []
        items.reserveCapacity(end - start)
        if start < end {
            for index in start..<end {
                try Task.checkCancellation()
                let asset = snapshot.object(at: index)
                let kind: String
                switch asset.mediaType {
                case .image: kind = "image"
                case .video: kind = "video"
                default: kind = "unsupported"
                }
                if let expected = filter.expectedKind, expected != kind {
                    reset()
                    throw XDrivePhotoKitScanFailure.snapshotChanged
                }
                items.append(XDrivePhotoKitScanCandidate(
                    id: asset.localIdentifier, kind: kind,
                    isLive: kind == "image" && asset.mediaSubtypes.contains(.photoLive),
                    capturedAt: asset.creationDate, modifiedAt: asset.modificationDate
                ))
            }
        }
        try ensureCurrent(permission)
        try Task.checkCancellation()
        nextOffset = end
        return XDrivePhotoKitScanPage(
            totalAccessibleAssets: snapshot.count, startOffset: start,
            nextOffset: end, limitedAuthorization: permission == .limited,
            items: items
        )
    }


    /// Read precisely the previous slot in the SAME verified filtered
    /// PhotoKit snapshot as nextPage(). No entire-page lookback or ID cache.
    func precedingCaptureDate(beforeOffset offset: Int) throws -> Date? {
        guard let snapshot, let permission else {
            throw XDrivePhotoKitScanFailure.notStarted
        }
        guard offset > 0, offset <= snapshot.count, offset % 64 == 0 else {
            throw XDrivePhotoKitScanFailure.invalidOffset
        }
        try ensureCurrent(permission)
        try Task.checkCancellation()
        let date = snapshot.object(at: offset - 1).creationDate
        try ensureCurrent(permission)
        return date
    }

    func reset() {
        snapshot = nil
        permission = nil
        version = 0
        nextOffset = 0
        filter = .all
        if listening {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
            listening = false
        }
    }

    private func ensureCurrent(_ expected: PHAuthorizationStatus) throws {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == expected,
              expected == .authorized || expected == .limited,
              observer.current() == version else {
            reset()
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
    }
}
