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
        if mediaFilter.requiresFavorite {
            options.predicate = NSPredicate(format: "favorite == YES")
        }
        let result: PHFetchResult<PHAsset>
        switch mediaFilter {
        case .all:
            result = PHAsset.fetchAssets(with: options)
        case .photos:
            result = PHAsset.fetchAssets(with: .image, options: options)
        case .videos:
            result = PHAsset.fetchAssets(with: .video, options: options)
        case .favorites:
            result = PHAsset.fetchAssets(with: options)
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
                if filter.requiresFavorite && !asset.isFavorite {
                    reset()
                    throw XDrivePhotoKitScanFailure.snapshotChanged
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


    /// Read one adjacent 64-slot page from the SAME filtered PhotoKit
    /// snapshot. Verify each current-page slot first, not just the selected
    /// ID, so insertions/reordering cannot silently shift a Viewer cursor.
    /// The caller must reset() in success, failure and cancellation cases.
    func adjacentPage(
        from current: XDrivePhotoKitScanPage,
        anchoredAt selected: XDrivePhotoKitScanCandidate,
        direction: Int
    ) throws -> XDrivePhotoKitScanPage? {
        guard let snapshot, let permission else {
            throw XDrivePhotoKitScanFailure.notStarted
        }
        try ensureCurrent(permission)
        try Task.checkCancellation()
        let total = snapshot.count
        guard current.totalAccessibleAssets == total,
              current.limitedAuthorization == (permission == .limited),
              current.startOffset >= 0, current.startOffset < total,
              current.startOffset % 64 == 0,
              current.items.count == min(64, total - current.startOffset),
              current.nextOffset == current.startOffset + current.items.count,
              direction == -1 || direction == 1
        else { throw XDrivePhotoKitScanFailure.snapshotChanged }

        let supported = current.items.filter {
            $0.kind == "image" || $0.kind == "video"
        }
        guard let edge = direction > 0 ? supported.last : supported.first,
              Self.sameMedia(edge, selected)
        else { throw XDrivePhotoKitScanFailure.snapshotChanged }

        for (index, expected) in current.items.enumerated() {
            try Task.checkCancellation()
            let asset = snapshot.object(at: current.startOffset + index)
            let type: String
            switch asset.mediaType {
            case .image: type = "image"
            case .video: type = "video"
            default: type = "unsupported"
            }
            guard asset.localIdentifier == expected.id,
                  asset.creationDate == expected.capturedAt,
                  asset.modificationDate == expected.modifiedAt,
                  type == expected.kind,
                  expected.isLive == (type == "image" &&
                      asset.mediaSubtypes.contains(.photoLive))
            else { throw XDrivePhotoKitScanFailure.snapshotChanged }
        }
        try ensureCurrent(permission)
        guard let target = XDriveIOSNativePhotoVirtualPagePolicy.adjacentOffset(
            current: current.startOffset, total: total, direction: direction
        ) else { return nil }

        nextOffset = target
        let result = try nextPage()
        // Only one adjacent page, at most 64 returned candidates. Never
        // silently skip an unsupported-only page to reach arbitrary photos.
        return result.items.contains {
            $0.kind == "image" || $0.kind == "video"
        } ? result : nil
    }

    private static func sameMedia(
        _ lhs: XDrivePhotoKitScanCandidate, _ rhs: XDrivePhotoKitScanCandidate
    ) -> Bool {
        lhs.id == rhs.id && lhs.kind == rhs.kind &&
        lhs.isLive == rhs.isLive && lhs.capturedAt == rhs.capturedAt &&
        lhs.modifiedAt == rhs.modifiedAt
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
