import Foundation

/// Server sends a cursor-page DTO for name-filtered children. The
/// counted Range DTO is ONLY for offset pagination: name + offset is 400.
struct XDriveIOSNativeFilesNamedPage: Decodable {
    let items: [XDriveIOSNativeFilesNode]
    let has_more: Bool
    let sort: String
    let order: String
    let next_cursor: String?
}

/// Native Files uses the same exact-name Server lookup as Web/PWA's
/// xDriveFileExplorerPathLookupPageOptions(name). No client-side folder scan.
enum XDriveIOSNativeFilesPathPolicy {
    static let maximumSegments = 32
    static let maximumPathBytes = 2_048

    static func segments(_ rawPath: String) -> [String]? {
        let normalized = rawPath.replacingOccurrences(of: "\\", with: "/")
        guard !normalized.isEmpty,
              normalized.utf8.count <= maximumPathBytes else { return nil }
        var parts = normalized.split(separator: "/")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if let first = parts.first, [
            "我的文件", "xDrive 云端", "云端文件"
        ].contains(first) { parts.removeFirst() }
        guard parts.count <= maximumSegments,
              parts.allSatisfy({ part in
                !part.isEmpty && part != "." && part != ".." &&
                part.utf8.count <= 255 &&
                !part.unicodeScalars.contains(where: { $0.value == 0 })
              }) else { return nil }
        return parts
    }

    static func validNamedChild(
        _ page: XDriveIOSNativeFilesNamedPage, parentID: UInt64,
        exactName: String
    ) -> Bool {
        guard parentID > 0, !exactName.isEmpty,
              !page.has_more, (page.next_cursor ?? "").isEmpty,
              page.sort == "name", page.order == "asc",
              page.items.count <= 1 else { return false }
        return page.items.allSatisfy { node in
            node.id > 0 && node.revision > 0 &&
            node.type == "dir" && node.parent_id == parentID &&
            node.name == exactName
        }
    }
}
