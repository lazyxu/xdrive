import CryptoKit
import Foundation
import Photos

struct XDriveIOSNativeExactPhotoProbe: Codable, Sendable {
    struct Component: Codable, Sendable {
        let role: String
        let size: Int64
        let sha256: String
    }

    let kind: String
    let components: [Component]

    var fingerprint: String? {
        let roles: [String]
        switch kind {
        case "image", "video": roles = ["primary"]
        case "live_photo": roles = ["still", "motion"]
        default: return nil
        }
        guard components.map(\.role) == roles,
              components.allSatisfy({ part in
                  part.size > 0 && part.sha256.utf8.count == 64 &&
                  part.sha256.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
              }) else { return nil }
        return ([kind] + components.map { "\($0.role):\($0.size):\($0.sha256)" }).joined(separator: "|")
    }

    /// Only the currently visible, locally readable original participates.
    /// This cannot start an upload or fetch bytes from iCloud.
    static func read(_ candidate: XDrivePhotoKitScanCandidate) async throws -> Self {
        guard let stamp = XDriveIOSNativePhotoProofStamp.current(candidate.id),
              stamp.modifiedAt == candidate.modifiedAt, stamp.createdAt == candidate.capturedAt,
              stamp.kind == candidate.kind, stamp.isLive == candidate.isLive,
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [candidate.id], options: nil).firstObject else {
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        let original = try XDrivePhotoKitOriginalExporter.originalResources(for: asset)
        var components: [Component] = []
        for part in original.parts {
            try Task.checkCancellation()
            guard XDriveIOSNativePhotoProofStamp.current(candidate.id) == stamp else {
                throw XDrivePhotoKitScanFailure.snapshotChanged
            }
            let role = candidate.isLive ? part.role : "primary"
            components.append(try await XDriveIOSNativePhotoHashRequest.read(part.resource, role: role))
        }
        try Task.checkCancellation()
        guard XDriveIOSNativePhotoProofStamp.current(candidate.id) == stamp else {
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        let probe = Self(kind: candidate.isLive ? "live_photo" : candidate.kind, components: components)
        guard probe.fingerprint != nil else { throw XDrivePhotoKitScanFailure.snapshotChanged }
        return probe
    }
}

/// Hash PhotoKit's chunks in-place with network access disabled. Request
/// cancellation never writes or retains an original on disk.
private final class XDriveIOSNativePhotoHashRequest: @unchecked Sendable {
    private let lock = NSLock()
    private let manager = PHAssetResourceManager.default()
    private var requestID: PHAssetResourceDataRequestID?
    private var cancelled = false
    private var finished = false
    private var digest = SHA256()
    private var size: Int64 = 0

    static func read(_ resource: PHAssetResource, role: String) async throws -> XDriveIOSNativeExactPhotoProbe.Component {
        let request = Self()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                let options = PHAssetResourceRequestOptions()
                options.isNetworkAccessAllowed = false
                let id = request.manager.requestData(for: resource, options: options) { bytes in
                    request.receive(bytes)
                } completionHandler: { error in
                    request.finish(role: role, error: error, continuation: continuation)
                }
                request.install(id)
            }
        } onCancel: {
            request.cancel()
        }
    }

    private func install(_ id: PHAssetResourceDataRequestID) {
        lock.lock()
        requestID = id
        let shouldCancel = cancelled && !finished
        lock.unlock()
        if shouldCancel { manager.cancelDataRequest(id) }
    }

    private func receive(_ bytes: Data) {
        lock.lock()
        defer { lock.unlock() }
        guard !cancelled, !finished else { return }
        let (total, overflow) = size.addingReportingOverflow(Int64(bytes.count))
        if overflow {
            size = -1
        } else if size >= 0 {
            size = total
            digest.update(data: bytes)
        }
    }

    private func cancel() {
        lock.lock()
        cancelled = true
        let id = finished ? nil : requestID
        lock.unlock()
        if let id { manager.cancelDataRequest(id) }
    }

    private func finish(
        role: String, error: Error?,
        continuation: CheckedContinuation<XDriveIOSNativeExactPhotoProbe.Component, Error>
    ) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let result: Result<XDriveIOSNativeExactPhotoProbe.Component, Error>
        if cancelled {
            result = .failure(CancellationError())
        } else if let error {
            result = .failure(error)
        } else if size <= 0 {
            result = .failure(XDrivePhotoKitExportFailure.originalResourceMissing)
        } else {
            result = .success(.init(role: role, size: size, sha256: digest.finalize().map {
                String(format: "%02x", $0)
            }.joined()))
        }
        lock.unlock()
        continuation.resume(with: result)
    }
}

struct XDriveIOSNativeExactPhotoReference: Encodable {
    let asset_id: UInt64
    let node_id: UInt64
    let revision: UInt64

    init?(_ item: XDriveIOSNativeMediaItem) {
        guard let asset = item.asset_id, asset > 0, item.id > 0, item.node.revision > 0 else { return nil }
        self.asset_id = asset
        self.node_id = item.id
        self.revision = item.node.revision
    }
}

struct XDriveIOSNativeExactPhotoFingerprints: Decodable {
    let fingerprints: [XDriveIOSNativeExactPhotoProbe?]
}

struct XDriveIOSNativeExactPhotoReply: Decodable {
    let matches: [XDriveIOSNativeExactPhotoMatch]
}

struct XDriveIOSNativeExactPhotoMatch: Decodable, Equatable {
    enum State: String, Decodable {
        case matched, unmatched, ambiguous
    }

    let state: State
    let asset_id: UInt64?
    let node_id: UInt64?
    let revision: UInt64?

    var isValid: Bool {
        if state == .matched { return (asset_id ?? 0) > 0 && (node_id ?? 0) > 0 && (revision ?? 0) > 0 }
        return asset_id == nil && node_id == nil && revision == nil
    }

    func matches(_ item: XDriveIOSNativeMediaItem) -> Bool {
        state == .matched && asset_id == item.asset_id && node_id == item.id && revision == item.node.revision
    }
}
