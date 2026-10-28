import Foundation
import Photos

enum XDrivePhotoKitExportFailure: Error {
    case notAuthorized
    case assetNotVisible
    case originalResourceMissing
    case incompleteLivePair
    case storageUnavailable
    case resourceTooLarge
}

/// One temporary, app-private PhotoKit resource file; its original filename
/// is not used as a disk path. No localIdentifier is persisted here.
struct XDriveStagedPhotoKitResource {
    let role: String
    let originalFilename: String
    let fileURL: URL
    let byteCount: Int64
}

/// Owns at most the explicitly requested PhotoKit originals. The caller must
/// call delete() after Server ACK, cancellation or failure; no background
/// caching is initiated by the exporter.
struct XDriveStagedPhotoKitAsset {
    let kind: String
    let folderURL: URL
    let resources: [XDriveStagedPhotoKitResource]

    func delete() { try? FileManager.default.removeItem(at: folderURL) }
}

/// Synchronize Apple's arbitrary serial PhotoKit callback queue with Task
/// cancellation and FileHandle writes, without unbounded buffered Data.
private final class PhotoKitRequestGate: @unchecked Sendable {
    private let lock = NSLock()
    private let manager: PHAssetResourceManager
    private let handle: FileHandle
    private let maximumBytes: Int64
    private var requestID: PHAssetResourceDataRequestID?
    private var failure: Error?
    private var complete = false
    private var byteCount: Int64 = 0

    init(manager: PHAssetResourceManager, handle: FileHandle, maximumBytes: Int64) {
        self.manager = manager
        self.handle = handle
        self.maximumBytes = maximumBytes
    }

    func install(_ id: PHAssetResourceDataRequestID) {
        lock.lock()
        requestID = id
        let shouldCancel = failure != nil
        lock.unlock()
        if shouldCancel { manager.cancelDataRequest(id) }
    }

    func receive(_ data: Data) {
        var toCancel: PHAssetResourceDataRequestID?
        lock.lock()
        if complete || failure != nil {
            lock.unlock()
            return
        }
        let incoming = Int64(data.count)
        if incoming > maximumBytes - byteCount {
            failure = XDrivePhotoKitExportFailure.resourceTooLarge
            toCancel = requestID
        } else {
            do {
                try handle.write(contentsOf: data)
                byteCount += incoming
            } catch {
                failure = error
                toCancel = requestID
            }
        }
        lock.unlock()
        if let toCancel { manager.cancelDataRequest(toCancel) }
    }

    func cancel() {
        lock.lock()
        if failure == nil { failure = CancellationError() }
        let id = requestID
        lock.unlock()
        if let id { manager.cancelDataRequest(id) }
    }

    func finish(_ photoError: Error?, continuation: CheckedContinuation<Int64, Error>) {
        lock.lock()
        if complete {
            lock.unlock()
            return
        }
        complete = true
        let error = failure ?? photoError
        let finalCount = byteCount
        lock.unlock()

        if let error {
            continuation.resume(throwing: error)
        } else if finalCount <= 0 {
            continuation.resume(throwing: XDrivePhotoKitExportFailure.storageUnavailable)
        } else {
            continuation.resume(returning: finalCount)
        }
    }
}

/// The *source* side of a future one-file/Live-pair backup. It exports bytes
/// only when invoked by an explicit user action; caller chooses whether
/// iCloud originals may be downloaded. No server/Device/Owner is involved.
enum XDrivePhotoKitOriginalExporter {
    private static func authorized() -> Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return status == .authorized || status == .limited
    }

    /// Export one currently authorized PhotoKit asset, with a maximum of
    /// 1 GiB per resource by default. A Live Photo is all-or-nothing:
    /// both still and paired-video originals must be present and fully read.
    static func stage(localIdentifier: String, allowICloudDownload: Bool = false,
                      maximumBytesPerResource: Int64 = 1_073_741_824) async throws
        -> XDriveStagedPhotoKitAsset {
        guard authorized() else { throw XDrivePhotoKitExportFailure.notAuthorized }
        guard !localIdentifier.isEmpty,
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier],
                                              options: nil).firstObject
        else { throw XDrivePhotoKitExportFailure.assetNotVisible }
        guard maximumBytesPerResource > 0,
              maximumBytesPerResource <= 4_294_967_296 else {
            throw XDrivePhotoKitExportFailure.resourceTooLarge
        }

        let resources = PHAssetResource.assetResources(for: asset)
        let selected: [(role: String, resource: PHAssetResource)]
        let kind: String

        if asset.mediaType == .video {
            guard let video = resources.first(where: { $0.type == .fullSizeVideo })
                ?? resources.first(where: { $0.type == .video }) else {
                throw XDrivePhotoKitExportFailure.originalResourceMissing
            }
            kind = "video"
            selected = [("video", video)]
        } else if asset.mediaType == .image {
            guard let still = resources.first(where: { $0.type == .fullSizePhoto })
                ?? resources.first(where: { $0.type == .photo }) else {
                throw XDrivePhotoKitExportFailure.originalResourceMissing
            }
            if asset.mediaSubtypes.contains(.photoLive) {
                guard let motion = resources.first(where: { $0.type == .fullSizePairedVideo })
                    ?? resources.first(where: { $0.type == .pairedVideo }) else {
                    throw XDrivePhotoKitExportFailure.incompleteLivePair
                }
                kind = "live"
                selected = [("still", still), ("motion", motion)]
            } else {
                kind = "image"
                selected = [("still", still)]
            }
        } else {
            throw XDrivePhotoKitExportFailure.originalResourceMissing
        }

        // The private directory and resource-<index> paths are generated by
        // xDrive: never use untrusted PhotoKit filenames to build a path.
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("xdrive-photo-export-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700),
                         .protectionKey: FileProtectionType.complete]
        )
        var staged: [XDriveStagedPhotoKitResource] = []
        do {
            for (index, entry) in selected.enumerated() {
                try Task.checkCancellation()
                guard authorized(),
                      PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier],
                                          options: nil).firstObject != nil else {
                    throw XDrivePhotoKitExportFailure.assetNotVisible
                }

                let url = folder.appendingPathComponent("resource-\(index)", isDirectory: false)
                guard FileManager.default.createFile(
                    atPath: url.path, contents: nil,
                    attributes: [.posixPermissions: NSNumber(value: 0o600),
                                 .protectionKey: FileProtectionType.complete]
                ) else { throw XDrivePhotoKitExportFailure.storageUnavailable }

                let options = PHAssetResourceRequestOptions()
                options.isNetworkAccessAllowed = allowICloudDownload
                let size = try await writeResource(entry.resource, to: url,
                                                   options: options, maximumBytes: maximumBytesPerResource)
                try Task.checkCancellation()
                staged.append(XDriveStagedPhotoKitResource(
                    role: entry.role, originalFilename: entry.resource.originalFilename,
                    fileURL: url, byteCount: size
                ))
            }
            // A permission edit while iCloud bytes were loading invalidates
            // the entire pair. Never return partial files as a saved Live.
            guard authorized(),
                  PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier],
                                      options: nil).firstObject != nil else {
                throw XDrivePhotoKitExportFailure.assetNotVisible
            }
            return XDriveStagedPhotoKitAsset(kind: kind, folderURL: folder,
                                            resources: staged)
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
    }

    private static func writeResource(_ resource: PHAssetResource, to url: URL,
                                      options: PHAssetResourceRequestOptions,
                                      maximumBytes: Int64) async throws -> Int64 {
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        let manager = PHAssetResourceManager.default()
        let gate = PhotoKitRequestGate(manager: manager, handle: handle,
                                       maximumBytes: maximumBytes)

        let copied = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<Int64, Error>) in
                let id = manager.requestData(for: resource, options: options,
                    dataReceivedHandler: { data in
                        gate.receive(data)
                    }, completionHandler: { error in
                        gate.finish(error, continuation: continuation)
                    })
                gate.install(id)
            }
        } onCancel: {
            gate.cancel()
        }
        try Task.checkCancellation()
        try handle.synchronize()
        return copied
    }
}
