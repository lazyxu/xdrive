import CryptoKit
import Foundation

/// Bounded, disposable, versioned derivatives. This actor never stores
/// originals, PhotoKit IDs, credentials or signed URLs.
actor XDriveIOSNativePhotoThumbnailCache {
    static let shared = XDriveIOSNativePhotoThumbnailCache()

    struct Entry: Identifiable, Sendable {
        let id: String
        let bytes: Int
        let accessedAt: Date
    }

    private let maximumBytes = 512 * 1_048_576
    private let maximumEntries = 4096
    private let maximumFileBytes = 512 * 1024
    private var indices: [String: [String: Entry]] = [:]
    private var revision = UUID()

    static func scope(for owner: XDriveNativeOwnerRoot) -> String {
        digest("\(owner.origin.absoluteString)\n\(owner.instanceID)\n\(owner.ownerID)\n\(owner.rootNodeID)")
    }

    static func key(nodeID: UInt64, revision: UInt64, thumbnailVersion: String) -> String {
        digest("gallery-280:\(nodeID):\(revision):\(thumbnailVersion)")
    }

    private static func digest(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func valid(_ key: String) -> Bool {
        key.utf8.count == 64 && key.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }

    func writeRevision() -> UUID { revision }

    func entries(scope: String) throws -> [Entry] {
        try index(scope).values.sorted { $0.accessedAt > $1.accessedAt }
    }

    func load(scope: String, key: String) throws -> Data? {
        guard Self.valid(key), let entry = try index(scope)[key] else { return nil }
        let file = try directory(scope).appendingPathComponent(key)
        do {
            let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true,
                  values.fileSize == entry.bytes else {
                indices[scope]?[key] = nil
                return nil
            }
            let data = try Data(contentsOf: file)
            guard data.count == entry.bytes else { return nil }
            let now = Date()
            try? FileManager.default.setAttributes([.modificationDate: now], ofItemAtPath: file.path)
            indices[scope]?[key] = Entry(id: key, bytes: entry.bytes, accessedAt: now)
            return data
        } catch {
            // The OS can purge Library/Caches while the app is running.
            indices[scope]?[key] = nil
            return nil
        }
    }

    func save(_ data: Data, scope: String, key: String, expectedRevision: UUID) throws {
        guard revision == expectedRevision, Self.valid(key),
              !data.isEmpty, data.count <= maximumFileBytes else { return }
        let folder = try directory(scope)
        var current = try index(scope)
        var bytes = current.values.reduce(0) { $0 + $1.bytes } - (current[key]?.bytes ?? 0)
        var count = current.count - (current[key] == nil ? 0 : 1)
        if bytes + data.count > maximumBytes || count >= maximumEntries {
            for entry in current.values.sorted(by: { $0.accessedAt < $1.accessedAt }) where entry.id != key {
                try removeFile(folder.appendingPathComponent(entry.id))
                current[entry.id] = nil
                indices[scope]?[entry.id] = nil
                bytes -= entry.bytes
                count -= 1
                if bytes + data.count <= maximumBytes && count < maximumEntries { break }
            }
        }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: folder.appendingPathComponent(key), options: [.atomic, .completeFileProtection])
        current[key] = Entry(id: key, bytes: data.count, accessedAt: Date())
        indices[scope] = current
    }

    func remove(scope: String, keys: Set<String>? = nil) throws {
        // Fence writes from readers that started before the deletion.
        revision = UUID()
        let folder = try directory(scope)
        let current = try index(scope)
        for key in current.keys where keys?.contains(key) ?? true {
            try removeFile(folder.appendingPathComponent(key))
            indices[scope]?[key] = nil
        }
    }

    private func directory(_ scope: String) throws -> URL {
        guard Self.valid(scope) else { throw CocoaError(.fileReadInvalidFileName) }
        return try FileManager.default.url(
            for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        .appendingPathComponent("xdrive-gallery-thumbnails-v1", isDirectory: true)
        .appendingPathComponent(scope, isDirectory: true)
    }

    private func index(_ scope: String) throws -> [String: Entry] {
        if let cached = indices[scope] { return cached }
        let folder = try directory(scope)
        let manager = FileManager.default
        guard manager.fileExists(atPath: folder.path) else {
            indices[scope] = [:]
            return [:]
        }
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]
        let files = try manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: Array(keys))
        var result: [String: Entry] = [:]
        for file in files {
            let key = file.lastPathComponent
            guard Self.valid(key), let values = try? file.resourceValues(forKeys: keys),
                  values.isRegularFile == true, values.isSymbolicLink != true,
                  let bytes = values.fileSize, bytes > 0, bytes <= maximumFileBytes else { continue }
            result[key] = Entry(id: key, bytes: bytes, accessedAt: values.contentModificationDate ?? .distantPast)
        }
        indices[scope] = result
        return result
    }

    private func removeFile(_ file: URL) throws {
        let manager = FileManager.default
        if manager.fileExists(atPath: file.path) { try manager.removeItem(at: file) }
    }
}
