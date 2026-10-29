import Foundation

enum XDriveManualDocumentStageError: Error {
    case notAnAccessibleFile
    case tooLarge
    case invalidName
}

/// Private, one-shot copy of a Files-provider URL. No PhotoKit identity is
/// inferred and the original provider document is never modified or deleted.
struct XDriveStagedManualDocument {
    let fileURL: URL
    let directoryURL: URL
    let originalName: String
    let byteCount: Int64

    func delete() {
        try? FileManager.default.removeItem(at: directoryURL)
    }
}

enum XDriveManualDocumentStager {
    // First manual iOS upload is deliberately small; later large/background
    // transfers require a durable Owner transfer task and disk quota checks.
    static let maxFirstFileBytes: Int64 = 128 * 1_048_576

    static func stage(_ pickedURL: URL) async throws -> XDriveStagedManualDocument {
        try await Task.detached(priority: .userInitiated) {
            guard pickedURL.isFileURL else {
                throw XDriveManualDocumentStageError.notAnAccessibleFile
            }
            let name = pickedURL.lastPathComponent
            guard validFilename(name) else { throw XDriveManualDocumentStageError.invalidName }

            let securityScopeStarted = pickedURL.startAccessingSecurityScopedResource()
            defer {
                if securityScopeStarted { pickedURL.stopAccessingSecurityScopedResource() }
            }

            let fm = FileManager.default
            let attributes = try fm.attributesOfItem(atPath: pickedURL.path)
            guard (attributes[.type] as? FileAttributeType) == .typeRegular,
                  let originalSize = attributes[.size] as? NSNumber,
                  originalSize.int64Value >= 0 else {
                throw XDriveManualDocumentStageError.notAnAccessibleFile
            }
            guard originalSize.int64Value <= maxFirstFileBytes else {
                throw XDriveManualDocumentStageError.tooLarge
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
                    directoryURL: folder,
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
