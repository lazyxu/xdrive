import Foundation

/// One original-media transport policy, not two uploaders. Both variants
/// use the same sealed ledger, CAS UploadSession and exact Node readback.
/// A restricted BG grant is never accepted by a generic User/Source route.
enum XDriveIOSOriginalOwnerAuthorization {
    case webBearer(String)
    case background(XDriveIOSApprovedPhotoBGCredential)

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
        case .background(let approved):
            guard approved.matches(owner),
                  let verified = try? await XDriveIOSApprovedPhotoBGVault.shared
                    .proveInBackground(),
                  verified.grantID == approved.grantID,
                  verified.deviceID == approved.deviceID,
                  verified.rootNodeID == owner.rootNodeID,
                  verified.ownerID == owner.ownerID,
                  verified.instanceID == owner.instanceID else {
                throw XDrivePhotoSyncLedgerError.identityMismatch
            }
        }
        try Task.checkCancellation()
    }

    func transport(origin: URL) throws -> XDriveNativeUploadSessionTransport {
        switch self {
        case .webBearer(let token):
            return try XDriveNativeUploadSessionTransport(
                origin: origin, accessToken: token
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
        guard approved.matches(owner), parentID == owner.rootNodeID,
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
        parts.path = "/api/v1/ios/photos/background/receipts/nodes/\(receipt.nodeID)"
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
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200, bytes.count <= 65_536,
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
