import Foundation

/// A display name for a native user-created PhotoKit album, never a Server path.
enum XDriveIOSNativeAlbumNamePolicy {
    static let maximumCharacters = 80
    static let maximumUTF8Bytes = 255

    static func normalized(_ proposed: String) -> String? {
        let name = proposed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty,
              name.count <= maximumCharacters,
              name.utf8.count <= maximumUTF8Bytes,
              !name.unicodeScalars.contains(where: {
                  CharacterSet.controlCharacters.contains($0)
              })
        else { return nil }
        return name
    }
}
