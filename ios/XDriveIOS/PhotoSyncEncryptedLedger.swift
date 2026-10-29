import CryptoKit
import Foundation
import Security

/// A verified Server installation + Owner + root + Device partition.
/// This is NOT proof of permission: construct it only from a current
/// authenticated Server read and a trusted Device registration receipt.
struct XDrivePhotoSyncScope: Codable, Equatable {
    let origin: String
    let serverInstanceID: String
    let ownerID: UInt64
    let rootNodeID: UInt64
    let deviceID: String

    init(origin: URL, serverInstanceID: String, ownerID: UInt64,
         rootNodeID: UInt64, deviceID: String) throws {
        let canonical = try ServerAddress.parse(origin.absoluteString)
        guard !serverInstanceID.isEmpty, serverInstanceID.utf8.count <= 256,
              ownerID > 0, rootNodeID > 0,
              !deviceID.isEmpty, deviceID.utf8.count <= 256,
              ![serverInstanceID, deviceID].contains(where: { value in
                  value.unicodeScalars.contains(where: {
                      CharacterSet.controlCharacters.contains($0)
                  })
              }) else { throw XDrivePhotoSyncLedgerError.invalidIdentity }
        self.origin = canonical.absoluteString
        self.serverInstanceID = serverInstanceID
        self.ownerID = ownerID
        self.rootNodeID = rootNodeID
        self.deviceID = deviceID
    }
}

enum XDrivePhotoSyncResourceRole: String, Codable {
    case still, motion, video
}

/// No state denotes success until a Server-confirmed physical file receipt
/// has been checked and durably written. An unknown ACK never becomes "failed
/// so safe to repeat"; it requires Owner read-only reconciliation.
enum XDrivePhotoSyncOperationState: String, Codable {
    case prepared
    case creating
    case uploading
    case finalizing
    case needsReconciliation
    case confirmed
}

struct XDrivePhotoSyncOperation: Codable, Identifiable {
    let id: String
    /// HMAC of the ephemeral PhotoKit identity plus exact source/destination.
    /// The raw PHAsset.localIdentifier is never serialized.
    let assetFingerprint: String
    let role: XDrivePhotoSyncResourceRole
    let destinationParentID: UInt64
    let destinationName: String
    let byteSize: Int64
    let sha256: String
    let resumeKey: String
    let createdAt: Date
    var updatedAt: Date
    var state: XDrivePhotoSyncOperationState
    var sessionID: String?
    var verifiedNodeID: UInt64?
    var verifiedNodeRevision: UInt64?
}

enum XDrivePhotoSyncLedgerError: Error {
    case invalidIdentity
    case invalidResource
    case invalidTransition
    case identityMismatch
    case corruptOrInaccessible
    case tooManyPendingOperations
    case keychainUnavailable(OSStatus)
    case keyGenerationFailed
}

private struct XDrivePhotoLedgerEnvelope: Codable {
    let version: Int
    let scope: XDrivePhotoSyncScope
    var operations: [XDrivePhotoSyncOperation]
}

/// One actor across iPad scenes serializes read-modify-write operations.
/// Storage is Owner/Server/Root/Device-separated, authenticated with the
/// exact scope as AES-GCM associated data, and protected at rest.
actor XDrivePhotoSyncLedger {
    static let shared = XDrivePhotoSyncLedger()
    private init() {}

    private let maxOperations = 1024
    private let maxEnvelopeBytes = 4 * 1024 * 1024
    private let keychainService = "com.lazyxu.xdrive.ios.photosync.v1"
    private let keychainAccount = "encryption-key"

    /// Persist a stable resume key and operation BEFORE any upload create POST.
    /// Repeated scan of the same exact resource returns its prior state.
    func prepare(scope: XDrivePhotoSyncScope,
                 localIdentifier: String,
                 role: XDrivePhotoSyncResourceRole,
                 parentID: UInt64, name: String,
                 byteSize: Int64, sha256: String) throws -> XDrivePhotoSyncOperation {
        guard !localIdentifier.isEmpty, localIdentifier.utf8.count <= 4096,
              parentID > 0, byteSize >= 0,
              validName(name), validSHA256(sha256) else {
            throw XDrivePhotoSyncLedgerError.invalidResource
        }
        let scopeData = try canonicalData(scope)
        let key = try encryptionKey()
        let fingerprint = keyedHash(
            scopeData + Data("\n\(localIdentifier)\n\(role.rawValue)\n\(parentID)\n\(name)\n\(byteSize)\n\(sha256.lowercased())".utf8),
            secret: key
        )
        var envelope = try read(scope: scope, key: key)
        if let prior = envelope.operations.first(where: { $0.assetFingerprint == fingerprint }) {
            return prior
        }
        guard envelope.operations.count < maxOperations else {
            throw XDrivePhotoSyncLedgerError.tooManyPendingOperations
        }
        let uuid = UUID().uuidString.lowercased()
        let resumeKey = "ios_" + keyedHash(
            scopeData + Data("\nresume\n\(uuid)".utf8), secret: key
        )
        let now = Date()
        let operation = XDrivePhotoSyncOperation(
            id: uuid, assetFingerprint: fingerprint, role: role,
            destinationParentID: parentID, destinationName: name,
            byteSize: byteSize, sha256: sha256.lowercased(),
            resumeKey: resumeKey, createdAt: now, updatedAt: now,
            state: .prepared, sessionID: nil,
            verifiedNodeID: nil, verifiedNodeRevision: nil
        )
        envelope.operations.append(operation)
        try write(envelope, key: key)
        return operation
    }

    /// Can only be entered once: persist the possible-POST state first.
    /// A restarted process must reconcile instead of creating a new session.
    func beginCreate(scope: XDrivePhotoSyncScope, id: String) throws -> XDrivePhotoSyncOperation {
        try change(scope: scope, id: id) { entry in
            guard entry.state == .prepared else {
                throw XDrivePhotoSyncLedgerError.invalidTransition
            }
            entry.state = .creating
        }
    }

    func recordSession(scope: XDrivePhotoSyncScope, id: String,
                       sessionID: String) throws -> XDrivePhotoSyncOperation {
        try change(scope: scope, id: id) { entry in
            guard entry.state == .creating,
                  UUID(uuidString: sessionID) != nil else {
                throw XDrivePhotoSyncLedgerError.invalidTransition
            }
            entry.sessionID = sessionID
            entry.state = .uploading
        }
    }

    /// Persist uncertainty *before* calling POST /finalize.
    func beginFinalize(scope: XDrivePhotoSyncScope, id: String) throws -> XDrivePhotoSyncOperation {
        try change(scope: scope, id: id) { entry in
            guard entry.state == .uploading, entry.sessionID != nil else {
                throw XDrivePhotoSyncLedgerError.invalidTransition
            }
            entry.state = .finalizing
        }
    }

    func markUnknown(scope: XDrivePhotoSyncScope, id: String) throws -> XDrivePhotoSyncOperation {
        try change(scope: scope, id: id) { entry in
            guard entry.state != .confirmed else {
                throw XDrivePhotoSyncLedgerError.invalidTransition
            }
            entry.state = .needsReconciliation
        }
    }

    /// Attach an existing Server session UUID observed through a separate,
    /// authenticated and exact-Owner read-only reconciliation. The caller
    /// MUST verify the entire Server response first; this ledger cannot
    /// confer Server authority from a locally supplied UUID.
    ///
    /// This operation deliberately NEVER changes needsReconciliation into
    /// uploading/finalizing/confirmed. A restart must not silently resume a
    /// potentially committed write. Exact Session and Node readback is still
    /// necessary before any successful receipt can be recorded.
    func recordObservedSession(scope: XDrivePhotoSyncScope, id: String,
                               observedSessionID: String, parentID: UInt64,
                               name: String, byteSize: Int64,
                               fullSHA256: String, observedStatus: String)
        throws -> XDrivePhotoSyncOperation {
        guard UUID(uuidString: observedSessionID) != nil,
              observedStatus == "active" || observedStatus == "finalized",
              parentID > 0, byteSize >= 0,
              validSHA256(fullSHA256),
              fullSHA256 == fullSHA256.lowercased() else {
            throw XDrivePhotoSyncLedgerError.invalidTransition
        }
        return try change(scope: scope, id: id) { entry in
            guard entry.state == .needsReconciliation,
                  entry.sessionID == nil || entry.sessionID == observedSessionID,
                  entry.destinationParentID == parentID,
                  entry.destinationName == name,
                  entry.byteSize == byteSize,
                  entry.sha256 == fullSHA256,
                  entry.verifiedNodeID == nil,
                  entry.verifiedNodeRevision == nil else {
                throw XDrivePhotoSyncLedgerError.invalidTransition
            }
            entry.sessionID = observedSessionID
            // Uncertainty remains even if Server reports "finalized".
            // Only a validated Owner Node receipt may confirm this resource.
            entry.state = .needsReconciliation
        }
    }

    /// Only after the current Owner's GET/Finalize has *verified* the
    /// expected session, complete Node and full-file SHA-256 receipt.
    func confirmReceipt(scope: XDrivePhotoSyncScope, id: String,
                        sessionID: String, parentID: UInt64,
                        name: String, size: Int64, fullSHA256: String,
                        nodeID: UInt64, revision: UInt64) throws -> XDrivePhotoSyncOperation {
        try change(scope: scope, id: id) { entry in
            guard (entry.state == .finalizing || entry.state == .needsReconciliation),
                  entry.sessionID == sessionID,
                  entry.destinationParentID == parentID,
                  entry.destinationName == name, entry.byteSize == size,
                  entry.sha256 == fullSHA256.lowercased(),
                  nodeID > 0, revision > 0 else {
                throw XDrivePhotoSyncLedgerError.invalidTransition
            }
            entry.verifiedNodeID = nodeID
            entry.verifiedNodeRevision = revision
            entry.state = .confirmed
        }
    }

    /// On startup, the caller must reestablish precisely this Owner scope
    /// before reading records. Unconfirmed states are NOT automatically
    /// restarted and never masquerade as uploaded photos.
    func operations(scope: XDrivePhotoSyncScope) throws -> [XDrivePhotoSyncOperation] {
        try read(scope: scope, key: encryptionKey()).operations
    }

    /// Deleting local proof does not delete the Server's committed content.
    /// This is an explicit account-local reset, never a navigation side effect.
    func clearLocalRecords(scope: XDrivePhotoSyncScope) throws {
        let url = try fileURL(for: scope)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }

    private func change(scope: XDrivePhotoSyncScope, id: String,
                        mutate: (inout XDrivePhotoSyncOperation) throws -> Void) throws
        -> XDrivePhotoSyncOperation {
        let key = try encryptionKey()
        var envelope = try read(scope: scope, key: key)
        guard let index = envelope.operations.firstIndex(where: { $0.id == id }) else {
            throw XDrivePhotoSyncLedgerError.invalidTransition
        }
        var entry = envelope.operations[index]
        try mutate(&entry)
        entry.updatedAt = Date()
        envelope.operations[index] = entry
        try write(envelope, key: key)
        return entry
    }

    private func canonicalData(_ scope: XDrivePhotoSyncScope) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(scope)
    }

    private func fileURL(for scope: XDrivePhotoSyncScope) throws -> URL {
        guard let base = FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        ).first else { throw XDrivePhotoSyncLedgerError.corruptOrInaccessible }
        let dir = base.appendingPathComponent("xdrive-native-photo-ledgers-v1", isDirectory: true)
        try FileManager.default.createDirectory(
            at: dir, withIntermediateDirectories: true,
            attributes: [.posixPermissions: NSNumber(value: 0o700),
                         .protectionKey: FileProtectionType.complete]
        )
        let digest = SHA256.hash(data: try canonicalData(scope))
        return dir.appendingPathComponent(
            "ledger-" + hex(digest) + ".bin", isDirectory: false
        )
    }

    private func read(scope: XDrivePhotoSyncScope, key: Data) throws -> XDrivePhotoLedgerEnvelope {
        let url = try fileURL(for: scope)
        guard FileManager.default.fileExists(atPath: url.path) else {
            return XDrivePhotoLedgerEnvelope(version: 1, scope: scope, operations: [])
        }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard (attributes[.type] as? FileAttributeType) == .typeRegular,
                  let length = attributes[.size] as? NSNumber,
                  length.intValue > 0, length.intValue <= maxEnvelopeBytes else {
                throw XDrivePhotoSyncLedgerError.corruptOrInaccessible
            }
            let ciphertext = try Data(contentsOf: url)
            let box = try AES.GCM.SealedBox(combined: ciphertext)
            let plaintext = try AES.GCM.open(
                box, using: SymmetricKey(data: key), authenticating: canonicalData(scope)
            )
            let envelope = try JSONDecoder().decode(XDrivePhotoLedgerEnvelope.self, from: plaintext)
            guard envelope.version == 1, envelope.scope == scope,
                  envelope.operations.count <= maxOperations,
                  Set(envelope.operations.map(\.id)).count == envelope.operations.count,
                  Set(envelope.operations.map(\.assetFingerprint)).count == envelope.operations.count
            else { throw XDrivePhotoSyncLedgerError.identityMismatch }
            return envelope
        } catch {
            // NEVER overwrite an unreadable, truncated, revoked or tampered
            // ledger. Unknown operations might already be committed remotely.
            throw XDrivePhotoSyncLedgerError.corruptOrInaccessible
        }
    }

    private func write(_ envelope: XDrivePhotoLedgerEnvelope, key: Data) throws {
        let plaintext = try JSONEncoder().encode(envelope)
        guard plaintext.count <= maxEnvelopeBytes else {
            throw XDrivePhotoSyncLedgerError.tooManyPendingOperations
        }
        let sealed = try AES.GCM.seal(
            plaintext, using: SymmetricKey(data: key),
            authenticating: canonicalData(envelope.scope)
        )
        guard let ciphertext = sealed.combined else {
            throw XDrivePhotoSyncLedgerError.corruptOrInaccessible
        }
        let url = try fileURL(for: envelope.scope)
        try ciphertext.write(to: url, options: [.atomic, .completeFileProtection])
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: 0o600),
             .protectionKey: FileProtectionType.complete], ofItemAtPath: url.path
        )
        let file = try FileHandle(forWritingTo: url)
        defer { try? file.close() }
        try file.synchronize()
    }

    private func encryptionKey() throws -> Data {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount
        ]
        func fetch() -> (OSStatus, Data?) {
            var query = base
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            query[kSecReturnData as String] = true
            var value: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &value)
            return (status, value as? Data)
        }
        let (status, existing) = fetch()
        if status == errSecSuccess {
            guard let existing, existing.count == 32 else {
                throw XDrivePhotoSyncLedgerError.corruptOrInaccessible
            }
            return existing
        }
        guard status == errSecItemNotFound else {
            throw XDrivePhotoSyncLedgerError.keychainUnavailable(status)
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        let randomStatus = bytes.withUnsafeMutableBytes { buffer -> OSStatus in
            guard let address = buffer.baseAddress else { return errSecParam }
            return SecRandomCopyBytes(kSecRandomDefault, buffer.count, address)
        }
        guard randomStatus == errSecSuccess else {
            throw XDrivePhotoSyncLedgerError.keyGenerationFailed
        }
        let fresh = Data(bytes)
        var query = base
        query[kSecValueData as String] = fresh
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let created = SecItemAdd(query as CFDictionary, nil)
        if created == errSecSuccess { return fresh }
        // A second actor/process may have won the same first-install race.
        if created == errSecDuplicateItem {
            let (nextStatus, found) = fetch()
            if nextStatus == errSecSuccess, let found, found.count == 32 { return found }
        }
        throw XDrivePhotoSyncLedgerError.keychainUnavailable(created)
    }

    private func keyedHash(_ data: Data, secret: Data) -> String {
        hex(HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: secret)))
    }

    private func hex<S: Sequence>(_ sequence: S) -> String where S.Element == UInt8 {
        sequence.map { String(format: "%02x", $0) }.joined()
    }

    private func validSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 &&
        value.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 70) ||
            ($0 >= 97 && $0 <= 102) }
    }

    private func validName(_ name: String) -> Bool {
        !name.isEmpty && name.utf8.count <= 255 &&
        !name.hasSuffix(" ") && !name.hasSuffix(".") &&
        name != "." && name != ".." &&
        !name.unicodeScalars.contains(where: {
            $0.value < 32 || "/\\<>:\"|?*".unicodeScalars.contains($0)
        })
    }
}
