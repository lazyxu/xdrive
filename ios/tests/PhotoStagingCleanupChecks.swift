import Foundation

@main enum XDriveIOSPhotoStagingCleanupChecks {
    static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(
            "xdrive-staging-sweeper-fixture-" + UUID().uuidString,
            isDirectory: true
        )
        try fm.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: root) }
        let old = Date().addingTimeInterval(-72 * 3600)
        let recent = Date()
        func folder(named name: String, items: [String], modifiedAt: Date) throws -> URL {
            let dir = root.appendingPathComponent(name, isDirectory: true)
            try fm.createDirectory(at: dir, withIntermediateDirectories: false)
            for item in items {
                try Data("staged-original".utf8).write(to: dir.appendingPathComponent(item))
            }
            try fm.setAttributes([.modificationDate: modifiedAt], ofItemAtPath: dir.path)
            return dir
        }
        let prefix = XDriveIOSPhotoStagingCleanup.folderPrefix
        let stale1 = try folder(named: prefix + UUID().uuidString,
                                items: ["resource-0"], modifiedAt: old)
        let stale2 = try folder(named: prefix + UUID().uuidString,
                                items: ["resource-0", "resource-1", "original-live-pair.zip"],
                                modifiedAt: old)
        let fresh = try folder(named: prefix + UUID().uuidString,
                               items: ["resource-0"], modifiedAt: recent)
        let unknown = try folder(named: prefix + UUID().uuidString,
                                 items: ["do-not-delete"], modifiedAt: old)
        let foreign = try folder(named: "other-photo-export-" + UUID().uuidString,
                                 items: ["resource-0"], modifiedAt: old)
        let malformed = try folder(named: prefix + "not-a-uuid",
                                   items: ["resource-0"], modifiedAt: old)
        let symlink = root.appendingPathComponent(prefix + UUID().uuidString)
        try fm.createSymbolicLink(at: symlink, withDestinationURL: unknown)
        let linkedChild = try folder(named: prefix + UUID().uuidString,
                                     items: [], modifiedAt: old)
        try fm.createSymbolicLink(
            at: linkedChild.appendingPathComponent("resource-0"),
            withDestinationURL: foreign.appendingPathComponent("resource-0")
        )
        try fm.setAttributes([.modificationDate: old], ofItemAtPath: linkedChild.path)
        let nestedChild = try folder(named: prefix + UUID().uuidString,
                                     items: [], modifiedAt: old)
        try fm.createDirectory(at: nestedChild.appendingPathComponent("nested"),
                               withIntermediateDirectories: false)
        try fm.setAttributes([.modificationDate: old], ofItemAtPath: nestedChild.path)
        precondition(XDriveIOSPhotoStagingCleanup.removeOrphans(in: root, limit: 1) == 1)
        let remaining = [stale1, stale2].filter { fm.fileExists(atPath: $0.path) }
        precondition(remaining.count == 1)
        precondition(XDriveIOSPhotoStagingCleanup.removeOrphans(in: root) == 1)
        precondition(!fm.fileExists(atPath: stale1.path))
        precondition(!fm.fileExists(atPath: stale2.path))
        for file in [fresh, unknown, foreign, malformed, symlink,
                     linkedChild, nestedChild] {
            precondition(fm.fileExists(atPath: file.path))
        }
        precondition(XDriveIOSPhotoStagingCleanup.removeOrphans(in: root) == 0)
        precondition(XDriveIOSPhotoStagingCleanup.removeOrphans(in: root, limit: 17) == 0)
        print("xDrive iOS orphan PhotoKit staging cleanup: PASS")
    }
}
