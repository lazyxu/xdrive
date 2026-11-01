import Foundation

/// Only verified files within the active Owner's bounded directory page may
/// become native Viewer targets. No implicit cross-page/full-library scan.
enum XDriveIOSNativeFilesViewerKind: String {
    case image, video, pdf, audio, text, unsupported
}

enum XDriveIOSNativeFilesViewerPolicy {
    static let maximumLoadedRows = 64
    static let maximumImageBytes: Int64 = 32 * 1_048_576
    static let maximumPDFBytes: Int64 = 64 * 1_048_576

    private static let images: Set<String> = [
        "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff",
        "avif", "bmp"
    ]
    private static let videos: Set<String> = ["mp4", "mov", "m4v"]
    private static let audio: Set<String> = ["mp3", "m4a", "aac", "wav"]
    private static let texts: Set<String> = [
        "asm", "bash", "bat", "c", "cc", "cfg", "cjs", "conf", "cpp", "cs",
        "css", "csv", "dart", "go", "h", "hpp", "htm", "html", "ini",
        "java", "js", "json", "jsonl", "jsx", "kt", "log", "lua", "m",
        "md", "mjs", "mm", "patch", "php", "properties", "py", "r",
        "rb", "rs", "sh", "sql", "swift", "text", "toml", "ts", "tsv",
        "tsx", "txt", "xml", "yaml", "yml", "zsh"
    ]
    private static let textBasenames: Set<String> = [
        "readme", "license", "dockerfile", "makefile", "gemfile",
        "jenkinsfile", "copying", ".gitignore", ".dockerignore",
        ".env", ".editorconfig", ".npmrc"
    ]

    static func kind(for name: String) -> XDriveIOSNativeFilesViewerKind {
        let base = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if textBasenames.contains(base) || base.hasPrefix(".env.") { return .text }
        guard let dot = base.lastIndex(of: "."), dot != base.startIndex else {
            return .unsupported
        }
        let ext = String(base[base.index(after: dot)...])
        if images.contains(ext) { return .image }
        if videos.contains(ext) { return .video }
        if ext == "pdf" { return .pdf }
        if audio.contains(ext) { return .audio }
        if texts.contains(ext) { return .text }
        return .unsupported
    }

    private static func validFileRow(_ node: XDriveIOSNativeFilesNode) -> Bool {
        node.id > 0 && node.revision > 0 && node.type == "file" &&
            node.parent_id != nil && !node.name.isEmpty &&
            node.name.utf8.count <= 255 && node.size >= 0
    }

    static func canPreview(_ node: XDriveIOSNativeFilesNode) -> Bool {
        guard validFileRow(node) else { return false }
        switch kind(for: node.name) {
        case .unsupported: return false
        case .image: return node.size > 0 // Oversize originals use indexed thumbnails; raw GET remains bounded.
        case .pdf: return node.size > 0 && node.size <= maximumPDFBytes
        case .video, .audio: return node.size > 0
        case .text: return true
        }
    }

    static func loadedIndex(
        current: XDriveIOSNativeFilesNode,
        in loaded: [XDriveIOSNativeFilesNode],
        authorized: Bool
    ) -> Int? {
        guard authorized, validFileRow(current),
              !loaded.isEmpty, loaded.count <= maximumLoadedRows,
              Set(loaded.map(\.id)).count == loaded.count,
              loaded.allSatisfy({
                  $0.id > 0 && $0.revision > 0 &&
                  $0.parent_id == current.parent_id && $0.type == "file"
              }) else { return nil }
        return loaded.firstIndex(of: current)
    }

    static func neighbor(
        current: XDriveIOSNativeFilesNode,
        in loaded: [XDriveIOSNativeFilesNode],
        direction: Int,
        authorized: Bool
    ) -> XDriveIOSNativeFilesNode? {
        guard direction == -1 || direction == 1,
              let index = loadedIndex(
                current: current, in: loaded, authorized: authorized
              ) else { return nil }
        let files = loaded.filter { canPreview($0) }
        if let fileIndex = files.firstIndex(of: loaded[index]) {
            guard files.indices.contains(fileIndex + direction) else { return nil }
            return files[fileIndex + direction]
        }
        // The user can open an unsupported/oversized file to export it.
        // From that error state, navigation still reaches the nearest
        // previewable sibling, without crossing an Owner, parent or 64-row page.
        if direction == -1 {
            return loaded[..<index].reversed().first(where: canPreview)
        }
        return loaded[(index + 1)...].first(where: canPreview)
    }

    /// Signed tickets are relative, single-resource, single-query URLs only.
    static func validTicketPath(_ value: String, nodeID: UInt64) -> Bool {
        guard nodeID > 0, value.utf8.count <= 16_384,
              let url = URLComponents(string: value),
              url.scheme == nil, url.host == nil, url.port == nil,
              url.user == nil, url.password == nil, url.fragment == nil,
              url.percentEncodedPath == "/api/v1/file-preview/\(nodeID)",
              let queries = url.queryItems, queries.count == 1,
              queries[0].name == "ticket",
              let ticket = queries[0].value,
              !ticket.isEmpty, ticket.utf8.count <= 8_192
        else { return false }
        return true
    }

    static func validTicketType(
        kind: XDriveIOSNativeFilesViewerKind, ticketKind: String, mime: String
    ) -> Bool {
        switch kind {
        case .image: return ticketKind == "image" && mime.hasPrefix("image/")
        case .video: return ticketKind == "video" && mime.hasPrefix("video/")
        case .audio: return ticketKind == "audio" && mime.hasPrefix("audio/")
        case .pdf: return ticketKind == "pdf" && mime == "application/pdf"
        case .text, .unsupported: return false
        }
    }
}
