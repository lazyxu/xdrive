import CryptoKit
import Foundation
import Photos

/// A protected cache of exact local original fingerprints, not permission
/// or a server receipt. Every reused fingerprint is still looked up against
/// the current authenticated gallery before publishing a match.
actor XDriveIOSNativePhotoMatchMemo {
    static let shared = XDriveIOSNativePhotoMatchMemo()

    private struct Snapshot: Codable {
        let library: Data
        var order: [String]
        var probes: [String: XDriveIOSNativeExactPhotoProbe]
    }

    private var activeScope: String?
    private var snapshot: Snapshot?
    private var ticket = UUID()
    private let limit = 512

    func bind(scope: String, library: Data) -> UUID? {
        guard let current = try? NSKeyedUnarchiver.unarchivedObject(
            ofClass: PHPersistentChangeToken.self, from: library
        ) else { return nil }
        if activeScope == scope,
           XDriveIOSPhotoKitLibraryEpoch.matches(snapshot?.library, as: current) {
            return ticket
        }
        ticket = UUID()
        activeScope = scope
        snapshot = Snapshot(library: library, order: [], probes: [:])
        if let file = try? location(scope),
           let bytes = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
           bytes <= 524_288,
           let data = try? Data(contentsOf: file), data.count <= 524_288,
           let saved = try? JSONDecoder().decode(Snapshot.self, from: data),
           saved.order.count <= limit, saved.probes.count == saved.order.count,
           Set(saved.order) == Set(saved.probes.keys),
           XDriveIOSPhotoKitLibraryEpoch.matches(saved.library, as: current) {
            snapshot = saved
        }
        return ticket
    }

    func probe(localID: String, ticket expected: UUID) -> XDriveIOSNativeExactPhotoProbe? {
        guard ticket == expected else { return nil }
        return snapshot?.probes[Self.key(localID)]
    }

    func remember(_ probes: [(String, XDriveIOSNativeExactPhotoProbe)], ticket expected: UUID) {
        guard ticket == expected, let scope = activeScope, var current = snapshot else { return }
        for (id, probe) in probes {
            let key = Self.key(id)
            current.order.removeAll { $0 == key }
            current.order.append(key)
            current.probes[key] = probe
        }
        while current.order.count > limit {
            current.probes[current.order.removeFirst()] = nil
        }
        snapshot = current
        if let file = try? location(scope), let bytes = try? JSONEncoder().encode(current) {
            try? bytes.write(to: file, options: [.atomic, .completeFileProtection])
        }
    }

    private func location(_ scope: String) throws -> URL {
        guard scope.utf8.count == 64, scope.utf8.allSatisfy({
            (48...57).contains($0) || (97...102).contains($0)
        }) else { throw CocoaError(.fileReadInvalidFileName) }
        var folder = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ).appendingPathComponent("xdrive-gallery-local-fingerprints-v1", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var attributes = URLResourceValues()
        attributes.isExcludedFromBackup = true
        try folder.setResourceValues(attributes)
        return folder.appendingPathComponent(scope)
    }

    private static func key(_ localID: String) -> String {
        SHA256.hash(data: Data(localID.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
