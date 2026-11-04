import Foundation

/// One original-media transport policy, not two uploaders. Both variants
/// use the same sealed ledger, CAS UploadSession and exact Node readback.
/// A restricted BG grant is never accepted by a generic User/Source route.
/// Short-lived, current native Owner + registered iPhone + server-owned Source
/// target. This is NOT a Desktop Agent Root permission and never chooses a
/// writable destination from an untrusted client path.
struct XDriveIOSManagedOriginalAuthority {
    let owner: XDriveNativeOwnerRoot
    let destination: XDriveIOSPhotoManagedDestination
    let device: XDriveIOSBackgroundDeviceProof
    let accessToken: String

    func matches(_ current: XDriveNativeOwnerRoot) -> Bool {
        owner.origin == current.origin &&
        owner.instanceID == current.instanceID &&
        owner.ownerID == current.ownerID &&
        owner.rootNodeID == current.rootNodeID &&
        owner.username == current.username &&
        !accessToken.isEmpty &&
        destination.sourceID > 0 &&
        destination.targetNodeID > 0 &&
        destination.targetNodeID != current.rootNodeID &&
        destination.deviceID == device.deviceID &&
        UUID(uuidString: device.deviceID) != nil &&
        !device.secret.isEmpty
    }
}

enum XDriveIOSOriginalOwnerAuthorization {
    case webBearer(String)
    case background(XDriveIOSApprovedPhotoBGCredential)
    case managedForeground(XDriveIOSManagedOriginalAuthority)

    func verify(owner: XDriveNativeOwnerRoot) async throws {
        try Task.checkCancellation()
        switch self {
        case .webBearer(let token):
            guard !token.isEmpty else {
                throw XDrivePhotoSyncLedgerError.identityMismatch
            }
            let current = try await XDriveNativeOwnerRootVerifier(
                origin: owner.origin, accessToken: token,
                expectedUsername: owner.username
            ).verify()
            guard current.origin == owner.origin,
                  current.instanceID == owner.instanceID,
                  current.ownerID == owner.ownerID,
                  current.rootNodeID == owner.rootNodeID,
                  current.username == owner.username else {
                throw XDrivePhotoSyncLedgerError.identityMismatch
            }
        case .managedForeground(let authority):
            guard authority.matches(owner) else {
                throw XDrivePhotoSyncLedgerError.identityMismatch
            }
            let current = try await XDriveNativeOwnerRootVerifier(
                origin: owner.origin, accessToken: authority.accessToken,
                expectedUsername: owner.username
            ).verify()
            guard current.origin == owner.origin &&
                  current.instanceID == owner.instanceID &&
                  current.ownerID == owner.ownerID &&
                  current.rootNodeID == owner.rootNodeID &&
                  current.username == owner.username else {
                throw XDrivePhotoSyncLedgerError.identityMismatch
            }
        case .background(let approved):
            guard approved.matches(owner) else {
                throw XDrivePhotoSyncLedgerError.identityMismatch
            }
            // Preserve transient network/HTTP errors from this read-only
            // proof. try? would collapse a temporary Server outage into
            // identityMismatch and could falsely pause confirmed receipts.
            let verified = try await XDriveIOSApprovedPhotoBGVault.shared
                .proveInBackground()
            guard verified.grantID == approved.grantID,
                  verified.deviceID == approved.deviceID,
                  verified.rootNodeID == owner.rootNodeID,
                  verified.sourceID == approved.sourceID,
                  verified.targetNodeID == approved.targetNodeID,
                  verified.hasManagedDestination,
                  verified.ownerID == owner.ownerID,
                  verified.instanceID == owner.instanceID else {
                throw XDrivePhotoSyncLedgerError.identityMismatch
            }
        }
        try Task.checkCancellation()
    }

    func destinationParentID(owner: XDriveNativeOwnerRoot) -> UInt64 {
        switch self {
        case .webBearer:
            return owner.rootNodeID
        case .background(let approved):
            return approved.matches(owner) && approved.hasManagedDestination
                ? (approved.targetNodeID ?? 0) : 0
        case .managedForeground(let authority):
            return authority.matches(owner) ? authority.destination.targetNodeID : 0
        }
    }

    func transport(origin: URL) throws -> XDriveNativeUploadSessionTransport {
        switch self {
        case .webBearer(let token):
            return try XDriveNativeUploadSessionTransport(
                origin: origin, accessToken: token
            )
        case .managedForeground(let authority):
            return try XDriveNativeUploadSessionTransport(
                origin: origin, managedForeground: authority
            )
        case .background(let credential):
            return try XDriveNativeUploadSessionTransport(
                origin: origin, approvedBackgroundGrant: credential
            )
        }
    }

    func verifyNodeReceipt(
        _ receipt: XDriveNativeUploadReceipt,
        owner: XDriveNativeOwnerRoot, parentID: UInt64,
        expectedName: String
    ) async throws {
        try await verify(owner: owner)
        switch self {
        case .webBearer(let token):
            try await XDriveIOSNodeReceiptReadbackVerifier(
                owner: owner, accessToken: token
            ).verify(receipt, parentID: parentID, expectedName: expectedName)
        case .managedForeground(let authority):
            try await XDriveIOSManagedOriginalNodeReceiptVerifier(
                authority: authority, owner: owner
            ).verify(receipt, parentID: parentID, expectedName: expectedName)
        case .background(let grant):
            try await XDriveIOSBGOriginalNodeReceiptVerifier(
                approved: grant, owner: owner
            ).verify(receipt, parentID: parentID, expectedName: expectedName)
        }
    }
}

private struct XDriveIOSBGOriginalNodeDTO: Decodable {
    let id: UInt64
    let parent_id: UInt64
    let name: String
    let type: String
    let size: Int64
    let revision: UInt64
    let sha256: String
}

private final class XDriveIOSBGOriginalDenyRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Only the dedicated Go grant/Device/Owner/Root proof of an exact finalized
/// original, never a generic /nodes/:id read or an ambient WebKit cookie.
private struct XDriveIOSBGOriginalNodeReceiptVerifier {
    let approved: XDriveIOSApprovedPhotoBGCredential
    let owner: XDriveNativeOwnerRoot

    func verify(_ receipt: XDriveNativeUploadReceipt, parentID: UInt64,
                expectedName: String) async throws {
        guard approved.matches(owner), approved.hasManagedDestination,
              parentID == approved.targetNodeID,
              receipt.nodeID > 0, receipt.revision > 0,
              receipt.bytes > 0,
              receipt.nodeName == expectedName,
              UUID(uuidString: receipt.sessionID) != nil,
              XDriveIOSBackgroundOriginalNamePolicy.valid(expectedName),
              receipt.sha256.utf8.count == 64,
              receipt.sha256.utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
              }) else {
            throw XDriveIOSNodeReceiptReadbackError.invalidReceipt
        }
        let clean = try ServerAddress.parse(owner.origin.absoluteString)
        guard clean == owner.origin,
              var parts = URLComponents(url: clean, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNodeReceiptReadbackError.invalidOwner }
        parts.path = "/api/v1/ios/photos/background-managed/receipts/nodes/\(receipt.nodeID)"
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else {
            throw XDriveIOSNodeReceiptReadbackError.invalidOwner
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.urlCache = nil
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.timeoutIntervalForRequest = 20
        let session = URLSession(
            configuration: cfg, delegate: XDriveIOSBGOriginalDenyRedirect(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 20
        request.setValue(approved.deviceID, forHTTPHeaderField: "X-XDrive-Device-ID")
        request.setValue(approved.deviceToken, forHTTPHeaderField: "X-XDrive-Device-Token")
        request.setValue(approved.grantSecret, forHTTPHeaderField: "X-XDrive-IOS-Photo-Grant")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (bytes, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNodeReceiptReadbackError.missingOrInconsistentNode
        }
        // A transient HTTP response to this read-only Owner Node proof is
        // different from an actually absent or hash-mismatched Node.
        guard http.statusCode == 200 else {
            throw XDriveIOSNodeReceiptReadbackError.serverRejected(http.statusCode)
        }
        guard bytes.count <= 65_536,
              let node = try? JSONDecoder().decode(
                XDriveIOSBGOriginalNodeDTO.self, from: bytes
              ),
              node.id == receipt.nodeID, node.parent_id == parentID,
              node.name == expectedName, node.type == "file",
              node.size == receipt.bytes, node.revision == receipt.revision,
              node.sha256.lowercased() == receipt.sha256 else {
            throw XDriveIOSNodeReceiptReadbackError.missingOrInconsistentNode
        }
    }
}

    
/// Recheck the exact finalized, HMAC-tagged original under the real managed
/// Source/Node via an iPhone-only Go alias. Generic Files Node metadata alone
/// is not evidence that the current device uploaded this original.
private struct XDriveIOSManagedOriginalNodeReceiptVerifier {
    let authority: XDriveIOSManagedOriginalAuthority
    let owner: XDriveNativeOwnerRoot

    func verify(_ receipt: XDriveNativeUploadReceipt, parentID: UInt64,
                expectedName: String) async throws {
        guard authority.matches(owner),
              parentID == authority.destination.targetNodeID,
              receipt.nodeID > 0, receipt.revision > 0,
              receipt.bytes > 0, receipt.nodeName == expectedName,
              UUID(uuidString: receipt.sessionID) != nil,
              XDriveIOSBackgroundOriginalNamePolicy.valid(expectedName),
              receipt.sha256.utf8.count == 64,
              receipt.sha256.utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
              }) else { throw XDriveIOSNodeReceiptReadbackError.invalidReceipt }
        try Task.checkCancellation()
        let clean = try ServerAddress.parse(owner.origin.absoluteString)
        guard clean == owner.origin,
              var parts = URLComponents(url: clean, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNodeReceiptReadbackError.invalidOwner }
        parts.path = "/api/v1/ios/photos/managed/receipts/nodes/\(receipt.nodeID)"
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else {
            throw XDriveIOSNodeReceiptReadbackError.invalidOwner
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.urlCache = nil
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.timeoutIntervalForRequest = 20
        let session = URLSession(
            configuration: cfg, delegate: XDriveIOSBGOriginalDenyRedirect(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 20
        request.setValue("Bearer " + authority.accessToken,
                         forHTTPHeaderField: "Authorization")
        request.setValue(authority.device.deviceID,
                         forHTTPHeaderField: "X-XDrive-Device-ID")
        request.setValue(authority.device.secret,
                         forHTTPHeaderField: "X-XDrive-Device-Token")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (bytes, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNodeReceiptReadbackError.missingOrInconsistentNode
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNodeReceiptReadbackError.serverRejected(http.statusCode)
        }
        guard bytes.count > 0, bytes.count <= 65_536,
              let node = try? JSONDecoder().decode(
                XDriveIOSBGOriginalNodeDTO.self, from: bytes
              ), node.id == receipt.nodeID, node.parent_id == parentID,
              node.name == expectedName, node.type == "file",
              node.size == receipt.bytes, node.revision == receipt.revision,
              node.sha256.lowercased() == receipt.sha256 else {
            throw XDriveIOSNodeReceiptReadbackError.missingOrInconsistentNode
        }
    }
}
