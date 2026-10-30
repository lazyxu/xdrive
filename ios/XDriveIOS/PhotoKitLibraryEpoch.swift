import Foundation
import Photos

/// Shared, fail-closed PhotoKit generation witness for foreground and OS
/// BGProcessingTask cursors. The native caller must already have an approved
/// Owner/grant and Photos read permission before invoking capture().
enum XDriveIOSPhotoKitLibraryEpoch {
    struct Snapshot {
        let token: PHPersistentChangeToken
        let serialized: Data
        let authorization: Int
    }

    enum Failure: Error {
        case unauthorizedOrChanged
        case invalidTokenArchive
    }

    static func capture() throws -> Snapshot {
        let authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard authorization == .authorized || authorization == .limited else {
            throw Failure.unauthorizedOrChanged
        }
        let token = PHPhotoLibrary.shared().currentChangeToken
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == authorization else {
            throw Failure.unauthorizedOrChanged
        }
        let encoded = try NSKeyedArchiver.archivedData(
            withRootObject: token, requiringSecureCoding: true
        )
        guard !encoded.isEmpty, encoded.count <= 65_536 else {
            throw Failure.invalidTokenArchive
        }
        return Snapshot(
            token: token, serialized: encoded,
            authorization: authorization.rawValue
        )
    }

    /// Always decode with NSSecureCoding and compare token objects: archive
    /// bytes are not a stable identity across iOS coder implementations.
    static func matches(_ archived: Data?, as current: PHPersistentChangeToken) -> Bool {
        guard let archived, !archived.isEmpty, archived.count <= 65_536,
              let previous = try? NSKeyedUnarchiver.unarchivedObject(
                ofClass: PHPersistentChangeToken.self, from: archived
              ) else { return false }
        return previous.isEqual(current)
    }
}
