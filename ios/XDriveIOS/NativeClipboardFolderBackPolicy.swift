import Foundation

/// A SwiftUI Button may dispatch a previously-rendered action after the first
/// tap has already popped the last folder. Perform the nonempty check at the
/// time of the tap; `removeLast()` on an empty Array is a fatal Swift trap.
enum XDriveIOSNativeClipboardFolderBackPolicy {
    @discardableResult
    static func retreat<Folder>(path: inout [Folder]) -> Bool {
        guard !path.isEmpty else { return false }
        path.removeLast()
        return true
    }
}
