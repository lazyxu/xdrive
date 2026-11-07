import Foundation

enum XDriveManualDocumentStageError: Error {
    case notAnAccessibleFile
    case tooLarge
    case insufficientDiskSpace
    case invalidName
    case directProviderUnavailable
}

/// One foreground original: normally a one-shot private copy, or a
/// security-scoped provider URL held open when local duplication is not
/// affordable. No PhotoKit identity is inferred. The original source is
/// never modified or removed; cleanup releases only our own resources.
struct XDriveStagedManualDocument {
    let fileURL: URL
    let directoryURL: URL?
    let retainedSecurityScopeURL: URL?
    let originalName: String
    let byteCount: Int64

    var isDirectProviderRead: Bool { retainedSecurityScopeURL != nil }

    func delete() {
        if let directoryURL { try? FileManager.default.removeItem(at: directoryURL) }
        retainedSecurityScopeURL?.stopAccessingSecurityScopedResource()
    }
}

enum XDriveManualDocumentStager {
    // Foreground-only, one complete private staging copy at a time.
    // A direct provider read is transient, scoped and still uses the same
    // checked UploadSession/hash/chunk/finalize writer. No background replay.
    static let maxFirstFileBytes: Int64 = XDriveIOSNativeFilesUploadBatchPolicy.maximumStagedFileBytes

    static func stage(_ pickedURL: URL) async throws -> XDriveStagedManualDocument {
        try await Task.detached(priority: .userInitiated) {
            guard pickedURL.isFileURL else {
                throw XDriveManualDocumentStageError.notAnAccessibleFile
            }
            let name = pickedURL.lastPathComponent
            guard validFilename(name) else { throw XDriveManualDocumentStageError.invalidName }

            let securityScopeStarted = pickedURL.startAccessingSecurityScopedResource()
            var retainScopeUntilUploadCompletes = false
            defer {
                if securityScopeStarted && !retainScopeUntilUploadCompletes {
                    pickedURL.stopAccessingSecurityScopedResource()
                }
            }

            let fm = FileManager.default
            let attributes = try fm.attributesOfItem(atPath: pickedURL.path)
            guard (attributes[.type] as? FileAttributeType) == .typeRegular,
                  let originalSize = attributes[.size] as? NSNumber,
                  originalSize.int64Value >= 0 else {
                throw XDriveManualDocumentStageError.notAnAccessibleFile
            }
            let byteCount = originalSize.int64Value
            guard byteCount <= XDriveIOSNativeFilesUploadBatchPolicy.maximumDirectProviderBytes
            else { throw XDriveManualDocumentStageError.tooLarge }

            // A provider may reside on another filesystem. A private copy
            // can consume the full original size; use one only after a disk
            // preflight. Otherwise, directly read the picker-granted URL,
            // retaining its security scope throughout hashing and uploading.
            let filesystem = try? fm.attributesOfFileSystem(
                forPath: fm.temporaryDirectory.path
            )
            let freeBytes = (filesystem?[.systemFreeSize] as? NSNumber)?.int64Value
            if !XDriveIOSNativeFilesUploadBatchPolicy.mayStage(
                bytes: originalSize.int64Value, freeDiskBytes: freeBytes
            ) {
                guard XDriveIOSNativeFilesUploadBatchPolicy.mayReadDirectly(
                    bytes: byteCount, securityScopeStarted: securityScopeStarted
                ) else {
                    if byteCount > maxFirstFileBytes {
                        throw XDriveManualDocumentStageError.directProviderUnavailable
                    }
                    throw XDriveManualDocumentStageError.insufficientDiskSpace
                }
                // Do not leak access or treat a failed preflight as permission
                // to send a POST. The same writer verifies original size,
                // full SHA-256, every 8 MiB chunk and its final receipt.
                try Task.checkCancellation()
                retainScopeUntilUploadCompletes = true
                return XDriveStagedManualDocument(
                    fileURL: pickedURL, directoryURL: nil,
                    retainedSecurityScopeURL: pickedURL,
                    originalName: name, byteCount: byteCount
                )
            }
            try Task.checkCancellation()

            let folder = fm.temporaryDirectory.appendingPathComponent(
                "xdrive-ios-manual-upload-" + UUID().uuidString,
                isDirectory: true
            )
            try fm.createDirectory(
                at: folder, withIntermediateDirectories: false,
                attributes: [.posixPermissions: NSNumber(value: 0o700),
                             .protectionKey: FileProtectionType.complete]
            )
            let target = folder.appendingPathComponent("selected-original", isDirectory: false)
            do {
                try fm.copyItem(at: pickedURL, to: target)
                try fm.setAttributes(
                    [.posixPermissions: NSNumber(value: 0o600),
                     .protectionKey: FileProtectionType.complete],
                    ofItemAtPath: target.path
                )
                try Task.checkCancellation()
                let copied = try fm.attributesOfItem(atPath: target.path)
                guard (copied[.type] as? FileAttributeType) == .typeRegular,
                      let copiedSize = copied[.size] as? NSNumber,
                      copiedSize.int64Value == originalSize.int64Value else {
                    throw XDriveManualDocumentStageError.notAnAccessibleFile
                }
                return XDriveStagedManualDocument(
                    fileURL: target,
                    directoryURL: folder, retainedSecurityScopeURL: nil,
                    originalName: name,
                    byteCount: copiedSize.int64Value
                )
            } catch {
                try? fm.removeItem(at: folder)
                throw error
            }
        }.value
    }

    private static func validFilename(_ value: String) -> Bool {
        guard !value.isEmpty, value != ".", value != "..",
              value.utf8.count <= 255,
              !value.hasSuffix(" "), !value.hasSuffix("."),
              !value.unicodeScalars.contains(where: {
                  $0.value < 32 || "/\\<>:\"|?*".unicodeScalars.contains($0)
              }) else { return false }
        let stem = value.components(separatedBy: ".").first?.uppercased() ?? ""
        return !["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4",
                 "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
                 "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"].contains(stem)
    }
}
