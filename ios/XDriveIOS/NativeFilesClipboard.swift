import Combine
import Foundation

/// In-memory, Owner-scoped Files clipboard. It stores verified Node/revision
/// snapshots only; it never caches file bytes, access tokens or a CAS writer.
/// Paste uses the existing Server-atomic batch target transaction, which
/// rechecks every source revision and the destination's current identity.
@MainActor
final class XDriveIOSNativeFilesClipboard: ObservableObject {
    static let shared = XDriveIOSNativeFilesClipboard()

    struct Snapshot {
        let owner: XDriveNativeOwnerRoot
        let items: [XDriveIOSNativeFilesNode]
        let sourceParentID: UInt64
        let kind: XDriveIOSNativeFilesDestinationKind
    }

    @Published private(set) var revision = UUID()
    private var stored: Snapshot?

    private init() {}

    @discardableResult
    func capture(_ kind: XDriveIOSNativeFilesDestinationKind,
                 items: [XDriveIOSNativeFilesNode],
                 sourceParentID: UInt64,
                 owner: XDriveNativeOwnerRoot) -> Bool {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
                items, parentID: sourceParentID
              ) else { return false }
        stored = Snapshot(owner: owner, items: items,
                          sourceParentID: sourceParentID, kind: kind)
        revision = UUID()
        return true
    }

    func snapshot(for owner: XDriveNativeOwnerRoot?) -> Snapshot? {
        guard let owner, let stored,
              XDriveIOSNativePhotoOwnerScope.matches(owner, stored.owner)
        else { return nil }
        return stored
    }

    func canPaste(to destinationID: UInt64?, owner: XDriveNativeOwnerRoot?) -> Bool {
        guard let destinationID, let snapshot = snapshot(for: owner) else {
            return false
        }
        return XDriveIOSNativeFilesBatchTargetPolicy.validSelection(
            snapshot.items, sourceParentID: snapshot.sourceParentID,
            destinationID: destinationID, kind: snapshot.kind
        )
    }

    func clear() {
        stored = nil
        revision = UUID()
    }
}
