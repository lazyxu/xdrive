import Foundation

/// Native Files requests only Server-produced media derivatives, never
/// full original image/movie bytes for browsing tiles.
enum XDriveIOSNativeFilesThumbnailPolicy {
    static let maximumBytes = 2 * 1_048_576
    static let maximumConcurrent = 2
    static let maximumPixelEdge = 280

    private static let imageExtensions: Set<String> = [
        "jpg", "jpeg", "png", "gif", "webp", "avif", "bmp",
        "heic", "heif", "tif", "tiff", "dng", "nef", "arw", "cr3", "livp"
    ]
    private static let videoExtensions: Set<String> = ["mp4", "mov", "m4v"]

    static func canRequest(_ node: XDriveIOSNativeFilesNode) -> Bool {
        guard node.id > 0, node.revision > 0, node.parent_id != nil,
              node.type == "file", node.size > 0, !node.name.isEmpty,
              node.name.utf8.count <= 255,
              let dot = node.name.lastIndex(of: "."),
              dot != node.name.startIndex else { return false }
        let ext = String(node.name[node.name.index(after: dot)...]).lowercased()
        return imageExtensions.contains(ext) || videoExtensions.contains(ext)
    }

    static func isVideo(_ node: XDriveIOSNativeFilesNode) -> Bool {
        guard canRequest(node), let dot = node.name.lastIndex(of: ".") else {
            return false
        }
        return videoExtensions.contains(
            String(node.name[node.name.index(after: dot)...]).lowercased()
        )
    }

    static func acceptedMIME(_ raw: String?) -> Bool {
        guard let raw else { return false }
        let mime = (raw.split(separator: ";", maxSplits: 1).first.map(String.init) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["image/jpeg", "image/png", "image/heic", "image/webp"].contains(mime)
    }
}
