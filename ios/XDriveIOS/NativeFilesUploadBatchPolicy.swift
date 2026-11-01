import Foundation

/// First native Files multi-pick MVP: at most eight documents, uploaded
/// sequentially through the existing single Original UploadSession writer.
/// Case-insensitive duplicate names would collide on Server; reject the
/// selection BEFORE uploading any item rather than skipping or overwriting.
enum XDriveIOSNativeFilesUploadBatchPolicy {
    static let maximumFiles = 8

    static func validSelection(_ files: [URL]) -> Bool {
        guard !files.isEmpty, files.count <= maximumFiles,
              files.allSatisfy({ $0.isFileURL }) else { return false }
        let names = files.map(\.lastPathComponent)
        guard names.allSatisfy({
            XDriveIOSNativeFilesFolderNamePolicy.normalized($0) == $0
        }) else { return false }
        return Set(names.map { $0.lowercased() }).count == files.count
    }
}
