import CryptoKit
import Foundation

struct XDriveIOSNativeExactPhotoProbe: Codable, Sendable {
    struct Component: Codable, Sendable {
        let role: String
        let size: Int64
        let sha256: String
    }

    let kind: String
    let components: [Component]

    /// Only the currently visible, locally readable original participates.
    /// This cannot start an upload or fetch bytes from iCloud.
    static func read(_ candidate: XDrivePhotoKitScanCandidate) async throws -> Self {
        guard let stamp = XDriveIOSNativePhotoProofStamp.current(candidate.id),
              stamp.modifiedAt == candidate.modifiedAt, stamp.createdAt == candidate.capturedAt,
              stamp.kind == candidate.kind, stamp.isLive == candidate.isLive else {
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        let staged = try await XDrivePhotoKitOriginalExporter.stage(
            localIdentifier: candidate.id, allowICloudDownload: false,
            maximumBytesPerResource: 256 * 1_048_576, allowLimitedPhotoAccess: true
        )
        defer { staged.delete() }
        let kind = candidate.isLive ? "live_photo" : candidate.kind
        let expectedRoles = candidate.isLive ? ["still", "motion"]
            : [candidate.kind == "video" ? "video" : "still"]
        guard staged.resources.map(\.role) == expectedRoles else {
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        let components = try staged.resources.map { resource in
            Component(
                role: candidate.isLive ? resource.role : "primary",
                size: resource.byteCount,
                sha256: try hash(resource.fileURL, size: resource.byteCount)
            )
        }
        try Task.checkCancellation()
        guard XDriveIOSNativePhotoProofStamp.current(candidate.id) == stamp else {
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        return Self(kind: kind, components: components)
    }

    private static func hash(_ url: URL, size: Int64) throws -> String {
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var digest = SHA256()
        var count: Int64 = 0
        while let bytes = try file.read(upToCount: 1_048_576), !bytes.isEmpty {
            try Task.checkCancellation()
            count += Int64(bytes.count)
            guard count <= size else { throw XDrivePhotoKitScanFailure.snapshotChanged }
            digest.update(data: bytes)
        }
        guard count == size, size > 0 else { throw XDrivePhotoKitScanFailure.snapshotChanged }
        return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }
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
