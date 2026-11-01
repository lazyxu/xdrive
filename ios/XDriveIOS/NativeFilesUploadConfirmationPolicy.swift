import Foundation

/// A Server-backed file receipt is accepted only when every required field
/// agrees with the exactly selected native Owner folder and staged original.
/// Neither a completed network task nor a session ID alone proves a file.
struct XDriveIOSNativeFilesUploadNodeEvidence {
    let id: UInt64
    let parentID: UInt64?
    let name: String
    let type: String
    let size: Int64
    let revision: UInt64
    let sha256: String?
}
enum XDriveIOSNativeFilesUploadConfirmationPolicy {
    static func matches(
        _ node: XDriveIOSNativeFilesUploadNodeEvidence,
        parentID: UInt64, name: String, bytes: Int64,
        receiptNodeID: UInt64, receiptRevision: UInt64, receiptSHA256: String
    ) -> Bool {
        let hash = receiptSHA256.lowercased()
        return parentID > 0 && !name.isEmpty &&
            bytes >= 0 && receiptNodeID > 0 && receiptRevision > 0 &&
            hash.utf8.count == 64 &&
            hash.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) ||
                                 ($0 >= 97 && $0 <= 102) } &&
            node.id == receiptNodeID && node.revision == receiptRevision &&
            node.parentID == parentID && node.name == name &&
            node.type == "file" && node.size == bytes &&
            node.sha256?.lowercased() == hash
    }
}
