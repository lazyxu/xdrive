import Foundation

/// Pure, bounded policy for explicit user-selected Markdown + local image
/// imports. Never fetch a Markdown image URL or infer Apple Notes identities.
enum XDriveIOSNativeManualNotesImportPolicy {
    enum Problem: LocalizedError {
        case unsafeImageReference
        case ambiguousFilename
        case missingSelectedImage
        case invalidAssetReceipt
        case tooManyFiles

        var errorDescription: String? {
            switch self {
            case .unsafeImageReference:
                return "Markdown 中有远程、绝对或不安全的图片路径；仅支持手动选择的相对路径图片。"
            case .ambiguousFilename:
                return "多个图片重名；请先调整文件名，避免导入时错误替换。"
            case .missingSelectedImage:
                return "Markdown 引用的图片未被同时选中，不能声称完成图片导入。"
            case .invalidAssetReceipt:
                return "服务器返回的图片相对路径无效。"
            case .tooManyFiles:
                return "一次最多选择 1 份 Markdown 和 32 张图片。"
            }
        }
    }

    static let maxImages = 32
    static let maxImageBytes = 20 * 1_048_576
    static let supportedImageExtensions: Set<String> =
        ["png", "jpg", "jpeg", "gif", "webp", "heic"]

    private static let imagePattern = try! NSRegularExpression(
        pattern: #"!\[[^\]\r\n]{0,180}\]\(([^)\r\n]{1,512})\)"#
    )

    /// The selected .md's image references must be local. We never follow
    /// http:, file:, data:, query strings, URL-encoded traversal or symlinks.
    static func localImageFilename(_ path: String) throws -> String {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.hasPrefix("~"),
              !path.contains("\\"),
              !path.contains("%"), !path.contains("?"), !path.contains("#"),
              !path.contains(":"),
              !path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
        else { throw Problem.unsafeImageReference }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.isEmpty,
              parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
              let last = parts.last,
              last.count <= 255
        else { throw Problem.unsafeImageReference }
        let name = String(last)
        guard let ext = name.split(separator: ".").last?.lowercased(),
              supportedImageExtensions.contains(ext)
        else { throw Problem.unsafeImageReference }
        return name
    }

    static func references(in markdown: String) throws -> [String] {
        let original = markdown as NSString
        let matches = imagePattern.matches(
            in: markdown, range: NSRange(location: 0, length: original.length)
        )
        var names: [String] = []
        for item in matches {
            let value = original.substring(with: item.range(at: 1))
            let filename = try localImageFilename(value)
            if !names.contains(filename) { names.append(filename) }
        }
        return names
    }

    static func selectedImages(
        requiredNames: [String], availableNames: [String]
    ) throws -> [String] {
        guard availableNames.count <= maxImages else { throw Problem.tooManyFiles }
        guard Set(availableNames).count == availableNames.count else {
            throw Problem.ambiguousFilename
        }
        guard requiredNames.allSatisfy({ availableNames.contains($0) }) else {
            throw Problem.missingSelectedImage
        }
        // Only explicitly referenced pictures are imported; extra selected
        // files do not silently consume private storage.
        return requiredNames
    }

    static func replacing(
        _ markdown: String, filename: String, with verifiedAssetPath: String,
        noteID: String
    ) throws -> String {
        let parts = verifiedAssetPath.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "_assets",
              parts[1].lowercased() == noteID.lowercased(),
              !parts[2].isEmpty,
              !verifiedAssetPath.contains("?"), !verifiedAssetPath.contains("#"),
              !verifiedAssetPath.contains("%")
        else { throw Problem.invalidAssetReceipt }
        let original = markdown as NSString
        let mutable = NSMutableString(string: markdown)
        let matches = imagePattern.matches(
            in: markdown, range: NSRange(location: 0, length: original.length)
        )
        // UTF-16 ranges remain correct in reverse order, including Chinese
        // and emoji titles/alt text.
        for match in matches.reversed() {
            let range = match.range(at: 1)
            let path = original.substring(with: range)
            if try localImageFilename(path) == filename {
                mutable.replaceCharacters(in: range, with: verifiedAssetPath)
            }
        }
        return mutable as String
    }
}
