import Foundation

/// Pure boundary policy for explicit, transient native Photos Share Sheet
/// exports. The imported original filename is never used as a disk path.
enum XDriveIOSNativeLocalPhotoSharePolicy {
    static let maximumItems = 8
    static let maximumResourceBytes: Int64 = 512 * 1_048_576
    static let maximumTotalBytes: Int64 = 2 * 1_073_741_824

    static func fileName(item: Int, resource: Int, original: String) -> String? {
        guard (0..<maximumItems).contains(item), (0..<2).contains(resource),
              !original.isEmpty, original.utf8.count <= 1024 else { return nil }
        let ext = (original as NSString).pathExtension.lowercased()
        guard !ext.isEmpty, ext.utf8.count <= 12,
              ext.unicodeScalars.allSatisfy({
                  (97...122).contains($0.value) || (48...57).contains($0.value)
              })
        else { return nil }
        return "xdrive-photo-\(item)-\(resource).\(ext)"
    }

    static func fitsBudget(existing: Int64, additional: Int64) -> Bool {
        existing >= 0 && existing <= maximumTotalBytes &&
        additional > 0 && additional <= maximumTotalBytes - existing
    }
}
