import Foundation

/// Conservative recovery of orphaned private PhotoKit export directories.
/// The live exporter always removes its staging directory in a defer/catch;
/// this sweeper is only for app termination before those handlers execute.
enum XDriveIOSPhotoStagingCleanup {
    static let folderPrefix = "xdrive-photo-export-"
    static let minimumAge: TimeInterval = 48 * 60 * 60
    static let maximumPerPass = 16

    /// Best effort: cleanup failure must not mutate a backup ledger, swallow
    /// an upload error or disable a newly authorized Photos operation.
    @discardableResult
    static func removeOrphans(in temporaryDirectory: URL,
                              now: Date = Date(),
                              limit: Int = maximumPerPass) -> Int {
        guard temporaryDirectory.isFileURL, limit > 0, limit <= maximumPerPass,
              let folders = try? FileManager.default.contentsOfDirectory(
                at: temporaryDirectory,
                includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey,
                                             .contentModificationDateKey],
                options: []
              ) else { return 0 }
        var removed = 0
        for folder in folders.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            if removed >= limit { break }
            let name = folder.lastPathComponent
            guard name.hasPrefix(folderPrefix) else { continue }
            let suffix = String(name.dropFirst(folderPrefix.count))
            guard let uuid = UUID(uuidString: suffix), uuid.uuidString == suffix,
                  let attrs = try? folder.resourceValues(forKeys: [
                    .isDirectoryKey, .isSymbolicLinkKey, .contentModificationDateKey
                  ]),
                  attrs.isDirectory == true, attrs.isSymbolicLink != true,
                  let touched = attrs.contentModificationDate,
                  now.timeIntervalSince(touched) > minimumAge else { continue }

            // Own only two generated resource slots and the optional Live ZIP.
            // Do not recursively delete a directory with unknown files, nested
            // paths or symlinks even if its name resembles our private prefix.
            guard let children = try? FileManager.default.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: [
                    .isRegularFileKey, .isSymbolicLinkKey
                ], options: []
            ), children.count <= 3 else { continue }
            var safe = true
            for child in children {
                let childName = child.lastPathComponent
                guard childName == "resource-0" || childName == "resource-1" ||
                      childName == "original-live-pair.zip",
                      let values = try? child.resourceValues(forKeys: [
                        .isRegularFileKey, .isSymbolicLinkKey
                      ]), values.isRegularFile == true,
                      values.isSymbolicLink != true else {
                    safe = false
                    break
                }
            }
            guard safe else { continue }
            do {
                try FileManager.default.removeItem(at: folder)
                removed += 1
            } catch {
                // Protected/missing/changed directories stay untouched.
            }
        }
        return removed
    }
}
