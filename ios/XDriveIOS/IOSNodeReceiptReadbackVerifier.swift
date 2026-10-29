import Foundation

enum XDriveIOSNodeReceiptReadbackError: Error {
    case invalidOwner
    case invalidReceipt
    case ownerOrRootChanged
    case missingOrInconsistentNode
    case serverRejected(Int)
}

private struct XDriveIOSNodeReadbackDTO: Decodable {
    let id: UInt64
    let parent_id: UInt64?
    let name: String
    let type: String
    let size: Int64
    let revision: UInt64
    let sha256: String?
}

private final class XDriveIOSNodeReadbackDenyRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// This is a SECOND, read-only Server authority check after UploadSession
/// finalize. It does not read the physical CAS blob: it verifies that the
/// current authenticated Owner still sees the exact committed Node metadata,
/// file digest and revision before the encrypted journal is marked confirmed.
struct XDriveIOSNodeReceiptReadbackVerifier {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    func verify(_ receipt: XDriveNativeUploadReceipt, parentID: UInt64,
                expectedName: String) async throws {
        let origin = try ServerAddress.parse(owner.origin.absoluteString)
        guard origin == owner.origin, !accessToken.isEmpty,
              owner.ownerID > 0, owner.rootNodeID > 0,
              parentID == owner.rootNodeID else {
            throw XDriveIOSNodeReceiptReadbackError.invalidOwner
        }
        guard receipt.nodeID > 0, receipt.revision > 0,
              receipt.bytes >= 0,
              !expectedName.isEmpty,
              receipt.nodeName == expectedName,
              receipt.sha256.utf8.count == 64,
              receipt.sha256.utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
              }) else {
            throw XDriveIOSNodeReceiptReadbackError.invalidReceipt
        }

        // Re-check this token's identity after the CAS/SQL finalize. The same
        // hostname can be reconfigured to a different xDrive installation;
        // the persisted installation and Owner/Root IDs must not drift.
        let current = try await XDriveNativeOwnerRootVerifier(
            origin: origin, accessToken: accessToken,
            expectedUsername: owner.username
        ).verify()
        guard current.origin == owner.origin,
              current.instanceID == owner.instanceID,
              current.ownerID == owner.ownerID,
              current.rootNodeID == owner.rootNodeID,
              current.username == owner.username else {
            throw XDriveIOSNodeReceiptReadbackError.ownerOrRootChanged
        }
        try Task.checkCancellation()

        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        components?.path = "/api/v1/nodes/\(receipt.nodeID)"
        guard let url = components?.url else {
            throw XDriveIOSNodeReceiptReadbackError.invalidOwner
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 20
        let session = URLSession(
            configuration: configuration,
            delegate: XDriveIOSNodeReadbackDenyRedirects(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        request.httpShouldHandleCookies = false
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")

        let (body, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNodeReceiptReadbackError.missingOrInconsistentNode
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNodeReceiptReadbackError.serverRejected(http.statusCode)
        }
        guard body.count <= 65_536,
              let node = try? JSONDecoder().decode(XDriveIOSNodeReadbackDTO.self, from: body),
              node.id == receipt.nodeID,
              node.parent_id == parentID,
              node.name == expectedName,
              node.type == "file",
              node.size == receipt.bytes,
              node.revision == receipt.revision,
              node.sha256?.lowercased() == receipt.sha256 else {
            throw XDriveIOSNodeReceiptReadbackError.missingOrInconsistentNode
        }
    }
}
