import Foundation
import CryptoKit

/// Only route hints are persisted. Never persist a Node payload, bearer,
/// signed URL, thumbnails, file bytes or a successful Server authorization.
struct XDriveIOSNativeFilesResumeSnapshot: Codable, Equatable {
    let version: Int
    let ownerScope: String
    var section: String
    var folderID: UInt64?
    var folderName: String?
    var pageOffset: Int
    var anchorID: UInt64?
    var sort: String
    var order: String
    var grouping: String
    var foldersFirst: Bool
}

/// A single fail-closed, Owner+Server+Root scoped recent Files route.
/// The saved folder must be re-read from the Server before navigating to it.
struct XDriveIOSNativeFilesResumeStore {
    static let key = "xdrive.ios.native.files.resume.v1"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    static func scope(_ owner: XDriveNativeOwnerRoot) -> String {
        let identity = [
            owner.instanceID, String(owner.ownerID),
            String(owner.rootNodeID), owner.origin.absoluteString
        ].joined(separator: "\n")
        return SHA256.hash(data: Data(identity.utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    static func valid(_ value: XDriveIOSNativeFilesResumeSnapshot) -> Bool {
        value.version == 1 &&
            value.ownerScope.count == 64 &&
            value.ownerScope.allSatisfy({ $0.isASCII && $0.isHexDigit }) &&
            ["recent", "browse", "favorites"].contains(value.section) &&
            (value.folderID == nil || value.folderID! > 0) &&
            (value.folderID == nil) == (value.folderName == nil) &&
            (value.folderName == nil || (
                !value.folderName!.isEmpty && value.folderName!.utf8.count <= 255
            )) &&
            ["name", "updated", "size", "type"].contains(value.sort) &&
            ["asc", "desc"].contains(value.order) &&
            ["none", "type", "modified", "size"].contains(value.grouping) &&
            value.pageOffset >= 0 && value.pageOffset <= 10_000_000 &&
            value.pageOffset % 64 == 0 &&
            (value.anchorID == nil || (
                value.folderID != nil && value.anchorID! > 0
            ))
    }

    func clear() {
        defaults.removeObject(forKey: Self.key)
    }

    func restore(owner: XDriveNativeOwnerRoot) -> XDriveIOSNativeFilesResumeSnapshot? {
        guard let data = defaults.data(forKey: Self.key) else { return nil }
        guard data.count <= 2048,
              let snapshot = try? JSONDecoder().decode(
                XDriveIOSNativeFilesResumeSnapshot.self, from: data
              ),
              Self.valid(snapshot),
              snapshot.ownerScope == Self.scope(owner)
        else {
            clear()
            return nil
        }
        return snapshot
    }

    private func write(_ snapshot: XDriveIOSNativeFilesResumeSnapshot) {
        guard Self.valid(snapshot),
              let data = try? JSONEncoder().encode(snapshot),
              data.count <= 2048 else { return }
        defaults.set(data, forKey: Self.key)
    }

    func saveSection(_ section: String, owner: XDriveNativeOwnerRoot) {
        guard ["recent", "browse", "favorites"].contains(section) else { return }
        var snapshot = restore(owner: owner) ??
            XDriveIOSNativeFilesResumeSnapshot(
                version: 1, ownerScope: Self.scope(owner),
                section: "browse", folderID: nil, folderName: nil,
                pageOffset: 0, anchorID: nil,
                sort: "name", order: "asc", grouping: "none", foldersFirst: true
            )
        snapshot.section = section
        write(snapshot)
    }

    func saveFolder(owner: XDriveNativeOwnerRoot, id: UInt64,
                    name: String, pageOffset: Int, anchorID: UInt64?,
                    sort: String, order: String, grouping: String,
                    foldersFirst: Bool) {
        guard id > 0, !name.isEmpty, name.utf8.count <= 255 else { return }
        write(XDriveIOSNativeFilesResumeSnapshot(
            version: 1, ownerScope: Self.scope(owner),
            section: "browse", folderID: id, folderName: name,
            pageOffset: pageOffset, anchorID: anchorID,
            sort: sort, order: order, grouping: grouping,
            foldersFirst: foldersFirst
        ))
    }

    func saveAnchor(owner: XDriveNativeOwnerRoot, folderID: UInt64,
                    pageOffset: Int, anchorID: UInt64?) {
        guard var snapshot = restore(owner: owner),
              snapshot.folderID == folderID else { return }
        snapshot.pageOffset = pageOffset
        snapshot.anchorID = anchorID
        write(snapshot)
    }
}
