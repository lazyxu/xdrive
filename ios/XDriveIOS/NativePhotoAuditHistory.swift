import CryptoKit
import Foundation

/// Completed foreground audit at a point in time, NOT today's live remote
/// coverage. Only counts, a timestamp and a verified managed Source/Target
/// pair are persisted. No PhotoKit local IDs, credentials or image bytes.
struct XDriveIOSNativePhotoAuditHistorySnapshot: Codable {
    let sourceID: UInt64
    let targetNodeID: UInt64
    let total: Int
    let matched: Int
    let unmatched: Int
    let at: Date
}

@MainActor
enum XDriveIOSNativePhotoAuditHistory {
    private static func key(owner: XDriveNativeOwnerRoot) -> String {
        let scope = owner.origin.absoluteString + "\n" + owner.instanceID +
            "\n" + String(owner.ownerID) + "\n" + String(owner.rootNodeID)
        return "xdrive.ios.photos.audit-history.v1." +
            SHA256.hash(data: Data(scope.utf8))
                .map { String(format: "%02x", $0) }.joined()
    }

    static func save(owner: XDriveNativeOwnerRoot, sourceID: UInt64,
                     targetNodeID: UInt64, total: Int, matched: Int,
                     unmatched: Int, at: Date = Date()) {
        guard sourceID > 0, targetNodeID > 0, targetNodeID != owner.rootNodeID,
              total >= 0, matched >= 0, unmatched >= 0,
              matched <= total, unmatched <= total,
              matched + unmatched == total else { return }
        let snap = XDriveIOSNativePhotoAuditHistorySnapshot(
            sourceID: sourceID, targetNodeID: targetNodeID,
            total: total, matched: matched, unmatched: unmatched, at: at
        )
        guard let encoded = try? JSONEncoder().encode(snap) else { return }
        UserDefaults.standard.set(encoded, forKey: key(owner: owner))
    }

    static func last(owner: XDriveNativeOwnerRoot)
        -> XDriveIOSNativePhotoAuditHistorySnapshot? {
        guard let data = UserDefaults.standard.data(forKey: key(owner: owner)),
              let snap = try? JSONDecoder().decode(
                XDriveIOSNativePhotoAuditHistorySnapshot.self, from: data
              ), snap.sourceID > 0, snap.targetNodeID > 0,
              snap.targetNodeID != owner.rootNodeID,
              snap.total >= 0, snap.matched >= 0, snap.unmatched >= 0,
              snap.matched <= snap.total, snap.unmatched <= snap.total,
              snap.matched + snap.unmatched == snap.total,
              snap.at.timeIntervalSince1970.isFinite,
              snap.at <= Date().addingTimeInterval(120) else { return nil }
        return snap
    }
}
