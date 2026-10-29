import Foundation
import Photos

/// One transient, in-memory candidate from an explicitly permitted PhotoKit
/// snapshot. Never serialize localIdentifier, GPS or filename into a sync log.
struct XDrivePhotoKitScanCandidate: Identifiable {
    let id: String
    let kind: String
    let isLive: Bool
    let capturedAt: Date?
    let modifiedAt: Date?
}

struct XDrivePhotoKitScanPage {
    let totalAccessibleAssets: Int
    let startOffset: Int
    let nextOffset: Int
    let limitedAuthorization: Bool
    let items: [XDrivePhotoKitScanCandidate]
    var finished: Bool { nextOffset >= totalAccessibleAssets }
}

enum XDrivePhotoKitScanFailure: Error {
    case notAuthorized
    case notStarted
    case snapshotChanged
    case invalidOffset
}

/// PhotoKit change notifications are not guaranteed to arrive on the main
/// thread. Invalidate the *entire* current scan on any library change. This
/// is conservative: even an unrelated album update may require a restart.
private final class XDrivePhotoKitScanChangeObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let lock = NSLock()
    private var version: UInt64 = 0

    func currentVersion() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return version
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        lock.lock()
        version &+= 1
        lock.unlock()
    }
}

/// Bounded, read-only first-pass scan. The PHFetchResult is PhotoKit's lazy
/// snapshot, not a 100k-entry Swift Array. Only one <=64-item page is returned
/// at a time; no byte fetch, upload, GPS read or background scan is scheduled.
///
/// A PHChange or Full/Limited authorization change invalidates the cursor
/// and forces a new scan. Index offsets are NOT stable persistent media IDs.
actor XDrivePhotoKitBoundedSnapshotScanner {
    static let pageSize = 64

    private let observer = XDrivePhotoKitScanChangeObserver()
    private var listening = false
    private var result: PHFetchResult<PHAsset>?
    private var authorization: PHAuthorizationStatus?
    private var changeVersion: UInt64 = 0
    private var nextOffset = 0

    deinit {
        if listening {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
        }
    }

    /// Explicit user-triggered initial scan; no permission prompt. If iOS
    /// Limited access is granted, the result is only the authorized subset.
    func start(atOffset requestedOffset: Int = 0) throws -> Int {
        reset()
        guard requestedOffset >= 0 else {
            throw XDrivePhotoKitScanFailure.invalidOffset
        }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            throw XDrivePhotoKitScanFailure.notAuthorized
        }
        PHPhotoLibrary.shared().register(observer)
        listening = true
        let beginVersion = observer.currentVersion()
        let options = PHFetchOptions()
        options.sortDescriptors = [
            NSSortDescriptor(key: "creationDate", ascending: false)
        ]
        let snapshot = PHAsset.fetchAssets(with: options)
        guard observer.currentVersion() == beginVersion,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == status else {
            reset()
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        result = snapshot
        authorization = status
        changeVersion = beginVersion
        // Select a bounded window without materializing or persisting skipped IDs.
        // Past-the-end windows are empty, not silently redirected to the first.
        nextOffset = min(requestedOffset, snapshot.count)
        return snapshot.count
    }

    func nextPage() throws -> XDrivePhotoKitScanPage {
        guard let snapshot = result, let initialAuthorization = authorization else {
            throw XDrivePhotoKitScanFailure.notStarted
        }
        try ensureCurrent(initialAuthorization)
        try Task.checkCancellation()

        let offset = nextOffset
        let end = min(snapshot.count, offset + Self.pageSize)
        var rows: [XDrivePhotoKitScanCandidate] = []
        rows.reserveCapacity(end - offset)

        if end > offset {
            for index in offset..<end {
                try Task.checkCancellation()
                let asset = snapshot.object(at: index)
                guard asset.mediaType == .image || asset.mediaType == .video else {
                    continue
                }
                rows.append(XDrivePhotoKitScanCandidate(
                    id: asset.localIdentifier,
                    kind: asset.mediaType == .video ? "video" : "image",
                    isLive: asset.mediaType == .image &&
                        asset.mediaSubtypes.contains(.photoLive),
                    capturedAt: asset.creationDate,
                    modifiedAt: asset.modificationDate
                ))
            }
        }

        // No advance until every candidate is read and the same permission
        // and photo-library generation are checked again.
        try ensureCurrent(initialAuthorization)
        try Task.checkCancellation()
        nextOffset = end

        return XDrivePhotoKitScanPage(
            totalAccessibleAssets: snapshot.count,
            startOffset: offset, nextOffset: end,
            limitedAuthorization: initialAuthorization == .limited,
            items: rows
        )
    }

    /// Drop the retained PHFetchResult; no IDs survive this scan or an app
    /// Owner switch. A future secure runner must independently revalidate
    /// current Owner, Device/Root, asset content and durable receipt.
    func reset() {
        result = nil
        authorization = nil
        nextOffset = 0
        changeVersion = 0
        if listening {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
            listening = false
        }
    }

    private func ensureCurrent(_ expected: PHAuthorizationStatus) throws {
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard current == expected,
              current == .authorized || current == .limited,
              observer.currentVersion() == changeVersion else {
            reset()
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
    }
}
