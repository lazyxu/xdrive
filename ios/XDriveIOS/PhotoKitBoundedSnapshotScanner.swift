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

/// Map-only transient coordinates, never part of the backup candidate.
struct XDrivePhotoKitLocatedCandidate: Identifiable {
    let candidate: XDrivePhotoKitScanCandidate
    let latitude: Double
    let longitude: Double
    // Transient PHFetchResult cursor position, never serialized. Cell album
    // pagination can resume after a 48th hit within a 64-slot scan page.
    var slotOffset: Int = 0
    var id: String { candidate.id }
}
struct XDrivePhotoKitLocatedPage {
    let page: XDrivePhotoKitScanPage
    let items: [XDrivePhotoKitLocatedCandidate]
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
/// snapshot, not a 100k-entry Swift Array. Only one <=64-slot page is returned
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
    private var mapFilenameTerm = ""
    // Only transient map scans may intersect a GPS day/cell trip. Backup
    // scans never inherit this source filter or its spatial membership.
    private var mapTripScope: XDriveIOSNativeLocalTripScope?
    // Transient backup-only mapping; at most one 256-item window is retained.
    // The snapshot, IDs and this mapping are discarded by reset().
    private var stableBoundaryPhysicalIndices: [Int: Int] = [:]

    deinit {
        if listening {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
        }
    }

    /// Explicit user-triggered initial scan; no permission prompt. If iOS
    /// Limited access is granted, the result is only the authorized subset.
    func start(atOffset requestedOffset: Int = 0,
               requireStableResume: Bool = false,
               album: XDriveLocalPhotoAlbumSummary? = nil) throws -> Int {
        try startConfigured(atOffset: requestedOffset,
                            requireStableResume: requireStableResume,
                            album: album, mediaFilter: .all)
    }

    /// Map-only filtered PhotoKit lease. Ordinary backup scans continue to use
    /// start() with its original all-media ordering and stable resume rules.
    /// A partially authorized PhotoKit library must never produce a map.
    func startMap(atOffset requestedOffset: Int = 0,
                   album: XDriveLocalPhotoAlbumSummary? = nil,
                   mediaFilter: XDriveIOSNativePhotoMediaFilter,
                   captureRange: XDriveIOSNativePhotoMapCaptureRange? = nil) throws -> Int {
        return try startMap(atOffset: requestedOffset, album: album,
                            mediaFilter: mediaFilter, captureRange: captureRange,
                            filenameTerm: "")
    }

    /// Applies exact originalFilename matching to a transient local map only.
    /// The Owner-cloud map cannot claim this unsupported Server-side filter.
    func startMap(atOffset requestedOffset: Int = 0,
                   album: XDriveLocalPhotoAlbumSummary? = nil,
                   mediaFilter: XDriveIOSNativePhotoMediaFilter,
                   captureRange: XDriveIOSNativePhotoMapCaptureRange? = nil,
                   filenameTerm: String,
                   tripScope: XDriveIOSNativeLocalTripScope? = nil) throws -> Int {
        let term = filenameTerm.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count <= 120 else {
            reset()
            throw XDrivePhotoKitScanFailure.invalidOffset
        }
        guard captureRange == nil || captureRange!.valid,
              tripScope == nil || (tripScope!.valid &&
                  captureRange == tripScope!.captureRange &&
                  XDriveIOSNativePhotoFingerprintIndex.isCurrent(
                    tripScope!.libraryEpoch))
        else {
            reset()
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized else {
            reset()
            throw XDrivePhotoKitScanFailure.notAuthorized
        }
        let count = try startConfigured(
            atOffset: requestedOffset, requireStableResume: false,
            album: album, mediaFilter: mediaFilter,
            requireFullLibrary: true, captureRange: captureRange)
        mapFilenameTerm = term
        mapTripScope = tripScope
        return count
    }

    private func startConfigured(atOffset requestedOffset: Int,
                                 requireStableResume: Bool,
                                 album: XDriveLocalPhotoAlbumSummary?,
                                 mediaFilter: XDriveIOSNativePhotoMediaFilter,
                                 requireFullLibrary: Bool = false,
                                 captureRange: XDriveIOSNativePhotoMapCaptureRange? = nil) throws -> Int {
        reset()
        guard requestedOffset >= 0 else {
            throw XDrivePhotoKitScanFailure.invalidOffset
        }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || (!requireStableResume && album == nil && status == .limited) else {
            throw XDrivePhotoKitScanFailure.notAuthorized
        }
        // Recheck at the actual snapshot admission, not only in startMap():
        // a Limited PhotoKit selection can never become a partial map.
        guard !requireFullLibrary || status == .authorized else {
            throw XDrivePhotoKitScanFailure.notAuthorized
        }
        PHPhotoLibrary.shared().register(observer)
        listening = true
        let beginVersion = observer.currentVersion()
        let options = PHFetchOptions()
        // PhotoKit throws an Objective-C exception for a localIdentifier
        // NSSortDescriptor. Only supported date keys may enter fetch options.
        // modificationDate reduces ties but is NOT a unique identity key.
        // Backup-only boundary groups are resolved in memory by stable IDs,
        // never by an unsupported localIdentifier NSSortDescriptor.
        options.sortDescriptors = [
            NSSortDescriptor(key: "creationDate", ascending: false),
            NSSortDescriptor(key: "modificationDate", ascending: false)
        ]
        // Map and Gallery use the same AND predicates. All-media scans retain
        // the original unfiltered backup PHFetchResult and cursor ordering.
        mediaFilter.applyPredicates(to: options)
        if let captureRange {
            guard requireFullLibrary && captureRange.valid else {
                reset()
                throw XDrivePhotoKitScanFailure.snapshotChanged
            }
            // This exact predicate is shared by the GPS overview scan and
            // the selected Cell's 48-item re-scan. Unknown dates are excluded.
            let timePredicate = NSPredicate(
                format: "creationDate >= %@ AND creationDate < %@",
                captureRange.from as NSDate, captureRange.to as NSDate)
            if let existing = options.predicate {
                options.predicate = NSCompoundPredicate(
                    andPredicateWithSubpredicates: [existing, timePredicate])
            } else {
                options.predicate = timePredicate
            }
        }
        let snapshot: PHFetchResult<PHAsset>
        if let album {
            guard let collection = PHAssetCollection.fetchAssetCollections(
                withLocalIdentifiers: [album.collectionIdentifier], options: nil
            ).firstObject else {
                reset()
                throw XDrivePhotoKitScanFailure.snapshotChanged
            }
            let rawName = collection.localizedTitle?.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            let currentName = rawName?.isEmpty == false ? rawName! : "未命名相册"
            let currentKind = collection.assetCollectionType == .album ? "用户相册" :
                collection.assetCollectionType == .smartAlbum ? "系统智能相册" : ""
            guard currentName == album.name, currentKind == album.kind else {
                reset()
                throw XDrivePhotoKitScanFailure.snapshotChanged
            }
            // Album fetches do not have PhotoKit's typed fetch overload.
            // Intersect the collection with the exact image/video criterion.
            if let kind = mediaFilter.fetchKind {
                let mediaType: PHAssetMediaType = kind == "image" ? .image : .video
                let typed = NSPredicate(format: "mediaType == %d", mediaType.rawValue)
                if let selected = options.predicate {
                    options.predicate = NSCompoundPredicate(
                        andPredicateWithSubpredicates: [selected, typed]
                    )
                } else {
                    options.predicate = typed
                }
            }
            snapshot = PHAsset.fetchAssets(in: collection, options: options)
        } else if mediaFilter.fetchKind == "image" {
            snapshot = PHAsset.fetchAssets(with: .image, options: options)
        } else if mediaFilter.fetchKind == "video" {
            snapshot = PHAsset.fetchAssets(with: .video, options: options)
        } else {
            snapshot = PHAsset.fetchAssets(with: options)
        }
        guard observer.currentVersion() == beginVersion,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == status else {
            reset()
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        let resumeOffset = min(requestedOffset, snapshot.count)
        let windowEnd = resumeOffset + min(
            XDrivePhotoBackupScanWindow.maxItems, snapshot.count - resumeOffset
        )
        // Only an authorized original-backup scan requests stable resume.
        // An equal-date group spanning either 256-slot edge can otherwise
        // reorder across PhotoKit fetches, skipping older originals forever.
        // Resolve at most 4096 tied entries, sorting their IDs in RAM, then
        // keep only the physical indices for this one 256-slot window.
        let boundaryIndices: [Int: Int]
        if requireStableResume {
            do {
                boundaryIndices = try Self.stableBackupBoundaryIndices(
                    snapshot, from: resumeOffset, to: windowEnd
                )
            } catch {
                reset()
                throw error
            }
        } else {
            boundaryIndices = [:]
        }
        guard observer.currentVersion() == beginVersion,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == status else {
            reset()
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        stableBoundaryPhysicalIndices = boundaryIndices
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
                let physicalIndex = stableBoundaryPhysicalIndices[index] ?? index
                let asset = snapshot.object(at: physicalIndex)
                // Preserve one candidate per PHFetchResult slot. Dropping
                // an unsupported kind here would advance PhotoKit's offset
                // without advancing the runner's scanned count, allowing the
                // selected 256-slot window to spill into the next one.
                let kind: String
                switch asset.mediaType {
                case .image: kind = "image"
                case .video: kind = "video"
                default: kind = "unsupported"
                }
                rows.append(XDrivePhotoKitScanCandidate(
                    id: asset.localIdentifier,
                    kind: kind,
                    isLive: kind == "image" &&
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

    /// Reuse the SAME lazy, permission-generation-fenced 64-slot PhotoKit
    /// scan for native map coordinates, without changing backup scan results.
    func nextLocatedPage() throws -> XDrivePhotoKitLocatedPage {
        guard let snapshot = result, let expected = authorization else {
            throw XDrivePhotoKitScanFailure.notStarted
        }
        let page = try nextPage()
        var placed: [XDrivePhotoKitLocatedCandidate] = []
        placed.reserveCapacity(page.items.count)
        for (offset, candidate) in page.items.enumerated() {
            try Task.checkCancellation()
            let logicalIndex = page.startOffset + offset
            let asset = snapshot.object(
                at: stableBoundaryPhysicalIndices[logicalIndex] ?? logicalIndex
            )
            guard asset.localIdentifier == candidate.id else {
                reset()
                throw XDrivePhotoKitScanFailure.snapshotChanged
            }
            guard candidate.kind != "unsupported", let location = asset.location else { continue }
            if !mapFilenameTerm.isEmpty {
                // Metadata only; no original bytes or iCloud download.
                guard PHAssetResource.assetResources(for: asset).contains(where: {
                    $0.originalFilename.localizedStandardContains(mapFilenameTerm)
                }) else { continue }
            }
            let latitude = location.coordinate.latitude
            let longitude = location.coordinate.longitude
            if let tripScope = mapTripScope {
                guard tripScope.contains(
                    candidate.capturedAt, latitude: latitude, longitude: longitude
                ) else { continue }
            }
            if XDriveIOSNativePhotoMapPolicy.validCoordinate(
                latitude: latitude, longitude: longitude
            ) {
                placed.append(XDrivePhotoKitLocatedCandidate(
                    candidate: candidate, latitude: latitude, longitude: longitude,
                    slotOffset: page.startOffset + offset
                ))
            }
        }
        try ensureCurrent(expected)
        try Task.checkCancellation()
        return XDrivePhotoKitLocatedPage(page: page, items: placed)
    }

    /// Drop the retained PHFetchResult; no IDs survive this scan or an app
    /// Owner switch. A future secure runner must independently revalidate
    /// current Owner, Device/Root, asset content and durable receipt.
    func reset() {
        result = nil
        authorization = nil
        nextOffset = 0
        changeVersion = 0
        mapFilenameTerm = ""
        mapTripScope = nil
        stableBoundaryPhysicalIndices.removeAll()
        if listening {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
            listening = false
        }
    }

    private static func sameSortKeys(_ a: PHAsset, _ b: PHAsset) -> Bool {
        a.creationDate == b.creationDate &&
            a.modificationDate == b.modificationDate
    }

    /// The 256-slot window is still complete and disjoint across runs even
    /// when PhotoKit reorders equal-date assets. A group larger than the
    /// bounded cap, duplicate IDs or an interleaving library mutation fails
    /// closed rather than guessing a persisted positional cursor.
    private static func stableBackupBoundaryIndices(
        _ snapshot: PHFetchResult<PHAsset>, from windowStart: Int, to windowEnd: Int
    ) throws -> [Int: Int] {
        var mapped: [Int: Int] = [:]
        let maxGroup = XDrivePhotoBackupTieBoundaryPolicy.maximumGroupSize
        for boundary in Set([windowStart, windowEnd]).sorted() {
            guard boundary > 0, boundary < snapshot.count else { continue }
            let before = snapshot.object(at: boundary - 1)
            let after = snapshot.object(at: boundary)
            guard sameSortKeys(before, after) else { continue }

            var first = boundary - 1
            while first > 0 && sameSortKeys(snapshot.object(at: first - 1), before) {
                guard boundary - first < maxGroup else {
                    throw XDrivePhotoKitScanFailure.snapshotChanged
                }
                first -= 1
            }
            var end = boundary + 1
            while end < snapshot.count && sameSortKeys(snapshot.object(at: end), before) {
                guard end - first < maxGroup else {
                    throw XDrivePhotoKitScanFailure.snapshotChanged
                }
                end += 1
            }
            guard end - first <= maxGroup else {
                throw XDrivePhotoKitScanFailure.snapshotChanged
            }
            let identifiers = (first..<end).map {
                snapshot.object(at: $0).localIdentifier
            }
            guard let slots = XDrivePhotoBackupTieBoundaryPolicy.mappingForGroup(
                identifiers: identifiers, groupStart: first,
                windowStart: windowStart, windowEnd: windowEnd
            ) else {
                throw XDrivePhotoKitScanFailure.snapshotChanged
            }
            for slot in slots {
                if let existing = mapped[slot.logicalIndex],
                   existing != slot.physicalIndex {
                    throw XDrivePhotoKitScanFailure.snapshotChanged
                }
                mapped[slot.logicalIndex] = slot.physicalIndex
            }
        }
        return mapped
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
