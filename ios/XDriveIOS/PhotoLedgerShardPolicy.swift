import Foundation

/// Pure, deterministic routing for the V2 encrypted PhotoKit intent journal.
/// Existing V1 UUIDs are never reinterpreted as V2: only new V2 writes use
/// their first three HMAC hex digits as the shard selector.
enum XDrivePhotoLedgerShardPolicy {
    static let prefixLength = 3
    static let maximumShardOperations = 1024

    static func isValidPrefix(_ prefix: String) -> Bool {
        prefix.utf8.count == prefixLength &&
        prefix.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
    }

    static func prefix(forFingerprint fingerprint: String) -> String? {
        guard fingerprint.utf8.count == 64,
              fingerprint.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) ||
                                           ($0 >= 97 && $0 <= 102) }) else {
            return nil
        }
        return String(fingerprint.prefix(prefixLength))
    }

    /// Preserve the UUID syntax expected by journal callers, but route every
    /// V2 operation ID back to exactly one shard without a separate index.
    static func makeOperationID(prefix: String, uuid: UUID = UUID()) -> String? {
        guard isValidPrefix(prefix) else { return nil }
        let value = uuid.uuidString.lowercased()
        return prefix + value.dropFirst(prefixLength)
    }

    static func prefix(forOperationID id: String) -> String? {
        guard id == id.lowercased(), UUID(uuidString: id) != nil else {
            return nil
        }
        let prefix = String(id.prefix(prefixLength))
        return isValidPrefix(prefix) ? prefix : nil
    }
}
