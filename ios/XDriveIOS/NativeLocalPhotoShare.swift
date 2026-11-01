import Foundation
import Photos
import SwiftUI
import UIKit

enum XDriveIOSNativeLocalShareFailure: Error {
    case invalidSelection
    case unsupportedOriginal
    case tooLarge
}

/// Keep files alive while UIActivityViewController / the recipient reads them.
/// A single user-initiated session owns every file and deletes them on dismiss.
final class XDriveIOSNativeLocalPhotoShareSession: Identifiable {
    let id = UUID()
    let fileURLs: [URL]
    let directoryURL: URL
    let containsLivePair: Bool

    init(fileURLs: [URL], directoryURL: URL, containsLivePair: Bool) {
        self.fileURLs = fileURLs
        self.directoryURL = directoryURL
        self.containsLivePair = containsLivePair
    }

    func discard() { try? FileManager.default.removeItem(at: directoryURL) }
    deinit { discard() }
}

/// Stage only the user's current 1..8 authorized PhotoKit originals. The
/// established Photos exporter streams bytes to a private file; no new reader,
/// network transport, backup writer or persistent media journal is created.
/// An iCloud-only source is fetched only after explicit user opt-in.
@MainActor
enum XDriveIOSNativeLocalOriginalSharer {
    static func prepare(
        _ candidates: [XDrivePhotoKitScanCandidate], allowICloudDownload: Bool
    ) async throws -> XDriveIOSNativeLocalPhotoShareSession {
        guard !candidates.isEmpty,
              candidates.count <= XDriveIOSNativeLocalPhotoSharePolicy.maximumItems
        else { throw XDriveIOSNativeLocalShareFailure.invalidSelection }
        _ = try XDriveIOSNativeLocalPhotoSelectionActions.verifiedAssets(candidates)
        try Task.checkCancellation()

        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("xdrive-ios-local-share-" + UUID().uuidString,
                                    isDirectory: true)
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700),
                         .protectionKey: FileProtectionType.complete]
        )
        var published: [URL] = []
        var bytes: Int64 = 0
        do {
            for (index, candidate) in candidates.enumerated() {
                try Task.checkCancellation()
                _ = try XDriveIOSNativeLocalPhotoSelectionActions.verifiedAssets([candidate])
                let staged = try await XDrivePhotoKitOriginalExporter.stage(
                    localIdentifier: candidate.id,
                    allowICloudDownload: allowICloudDownload,
                    maximumBytesPerResource:
                        XDriveIOSNativeLocalPhotoSharePolicy.maximumResourceBytes
                )
                defer { staged.delete() }
                guard ((candidate.kind == "image" && !candidate.isLive &&
                        staged.kind == "image" && staged.resources.count == 1) ||
                       (candidate.kind == "video" && staged.kind == "video" &&
                        staged.resources.count == 1) ||
                       (candidate.kind == "image" && candidate.isLive &&
                        staged.kind == "live" && staged.resources.count == 2))
                else { throw XDriveIOSNativeLocalShareFailure.unsupportedOriginal }
                for (part, resource) in staged.resources.enumerated() {
                    try Task.checkCancellation()
                    guard let fileName = XDriveIOSNativeLocalPhotoSharePolicy.fileName(
                        item: index, resource: part,
                        original: resource.originalFilename
                    ) else { throw XDriveIOSNativeLocalShareFailure.unsupportedOriginal }
                    guard XDriveIOSNativeLocalPhotoSharePolicy.fitsBudget(
                        existing: bytes, additional: resource.byteCount
                    ) else { throw XDriveIOSNativeLocalShareFailure.tooLarge }
                    let destination = folder.appendingPathComponent(
                        fileName, isDirectory: false
                    )
                    try FileManager.default.moveItem(at: resource.fileURL, to: destination)
                    try FileManager.default.setAttributes(
                        [.posixPermissions: NSNumber(value: 0o600),
                         .protectionKey: FileProtectionType.complete],
                        ofItemAtPath: destination.path
                    )
                    bytes += resource.byteCount
                    published.append(destination)
                }
                // Check the same PhotoKit ID/revision again after all bytes.
                _ = try XDriveIOSNativeLocalPhotoSelectionActions.verifiedAssets([candidate])
            }
            try Task.checkCancellation()
            _ = try XDriveIOSNativeLocalPhotoSelectionActions.verifiedAssets(candidates)
            guard !published.isEmpty else {
                throw XDriveIOSNativeLocalShareFailure.unsupportedOriginal
            }
            return XDriveIOSNativeLocalPhotoShareSession(
                fileURLs: published, directoryURL: folder,
                containsLivePair: candidates.contains(where: { $0.isLive })
            )
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
    }
}

/// System Share Sheet rather than an in-app copy pretending to be sent.
/// The caller retains the session until the OS sheet has been dismissed.
struct XDriveIOSNativeLocalPhotoActivitySheet: UIViewControllerRepresentable {
    let fileURLs: [URL]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: fileURLs, applicationActivities: nil)
    }

    func updateUIViewController(
        _ controller: UIActivityViewController, context: Context
    ) {}
}
