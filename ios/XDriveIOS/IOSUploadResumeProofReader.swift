import Foundation

/// Read-only observation of a previously persisted iOS upload intent.
/// A 404 or network failure is NEVER proof that it is safe to create a
/// second upload with a different resume key.
enum XDriveIOSUploadReconcileObservation {
    case active(sessionID: String, reportedChunkCount: Int)
    case finalized(sessionID: String, nodeID: UInt64, revision: UInt64)
    case noMatchingSession
    case expired
    case ambiguous
}

enum XDriveIOSUploadReconcileError: Error {
    case invalidOwner
    case invalidIntent
    case invalidResponse
    case serverRejected(Int)
}

private struct XDriveIOSUploadReconcileRequest: Encodable {
    let resume_key: String
    let parent_id: UInt64
    let name: String
    let size: Int64
    let chunk_size: Int64
    let sha256: String
}

private struct XDriveIOSUploadReconcileSession: Decodable {
    struct Chunk: Decodable {
        let index: Int
        let size: Int64
        let sha256: String
    }
    struct Node: Decodable {
        let id: UInt64
        let name: String
        let type: String
        let revision: UInt64
    }

    let id: String
    let parent_id: UInt64?
    let name: String?
    let requested_name: String?
    let conflict_policy: String?
    let size: Int64
    let chunk_size: Int64
    let chunk_count: Int
    let sha256: String?
    let resume_key: String?
    let status: String
    let received_chunks: [Chunk]
    let result: Node?
}

private final class XDriveIOSReconcileRejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Couples the existing encrypted intent with the server-side #3075
/// resume-key *read-only* lookup. No upload, finalize, Source or journal
/// writes are executed in this component.
struct XDriveIOSUploadResumeProofReader {
    let owner: XDriveNativeOwnerRoot
    let scope: XDrivePhotoSyncScope
    let accessToken: String

    func observe(_ operation: XDrivePhotoSyncOperation) async throws
        -> XDriveIOSUploadReconcileObservation {
        let origin = try ServerAddress.parse(owner.origin.absoluteString)
        guard origin == owner.origin, scope.origin == origin.absoluteString,
              scope.serverInstanceID == owner.instanceID,
              scope.ownerID == owner.ownerID,
              scope.rootNodeID == owner.rootNodeID,
              !scope.deviceID.isEmpty, !accessToken.isEmpty else {
            throw XDriveIOSUploadReconcileError.invalidOwner
        }
        guard operation.destinationParentID > 0,
              operation.byteSize >= 0,
              operation.sha256.count == 64,
              operation.sha256.utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
              }),
              operation.resumeKey.hasPrefix("ios_"),
              operation.resumeKey.count == 68,
              operation.resumeKey.dropFirst(4).utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
              }),
              !operation.destinationName.isEmpty,
              operation.destinationName.utf8.count <= 255,
              operation.sessionID == nil ||
                  UUID(uuidString: operation.sessionID!) != nil else {
            throw XDriveIOSUploadReconcileError.invalidIntent
        }

        // Revalidate authenticated Server identity on every recovery read.
        // A syntactically valid local scope is NOT an Owner authorization.
        let latest = try await XDriveNativeOwnerRootVerifier(
            origin: origin, accessToken: accessToken,
            expectedUsername: owner.username
        ).verify()
        guard latest.origin == owner.origin,
              latest.instanceID == scope.serverInstanceID,
              latest.ownerID == scope.ownerID,
              latest.rootNodeID == scope.rootNodeID else {
            throw XDriveIOSUploadReconcileError.invalidOwner
        }
        try Task.checkCancellation()

        let requestBody = try JSONEncoder().encode(XDriveIOSUploadReconcileRequest(
            resume_key: operation.resumeKey,
            parent_id: operation.destinationParentID,
            name: operation.destinationName,
            size: operation.byteSize,
            chunk_size: 8 * 1_048_576,
            sha256: operation.sha256
        ))
        var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        parts?.path = "/api/v1/uploads/resume-lookup"
        guard let url = parts?.url else {
            throw XDriveIOSUploadReconcileError.invalidOwner
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        let session = URLSession(
            configuration: config,
            delegate: XDriveIOSReconcileRejectRedirects(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.httpShouldHandleCookies = false
        req.timeoutInterval = 20
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        req.httpBody = requestBody
        let (bytes, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSUploadReconcileError.invalidResponse
        }
        switch http.statusCode {
        case 404: return .noMatchingSession
        case 409: return .ambiguous
        case 410: return .expired
        case 200: break
        default: throw XDriveIOSUploadReconcileError.serverRejected(http.statusCode)
        }

        guard bytes.count <= 2_097_152,
              let snapshot = try? JSONDecoder().decode(
                XDriveIOSUploadReconcileSession.self, from: bytes
              ),
              UUID(uuidString: snapshot.id) != nil,
              operation.sessionID == nil || operation.sessionID == snapshot.id,
              snapshot.parent_id == operation.destinationParentID,
              snapshot.name == operation.destinationName,
              snapshot.requested_name == operation.destinationName,
              snapshot.conflict_policy == nil ||
                  snapshot.conflict_policy == "" ||
                  snapshot.conflict_policy == "fail",
              snapshot.resume_key == operation.resumeKey,
              snapshot.size == operation.byteSize,
              snapshot.chunk_size == 8 * 1_048_576,
              snapshot.chunk_count == Int(
                (operation.byteSize + 8 * 1_048_576 - 1) / (8 * 1_048_576)
              ),
              snapshot.sha256 == operation.sha256,
              (snapshot.status == "active" || snapshot.status == "finalized")
        else { throw XDriveIOSUploadReconcileError.invalidResponse }

        var seen = Set<Int>()
        for part in snapshot.received_chunks {
            guard part.index >= 0, part.index < snapshot.chunk_count,
                  seen.insert(part.index).inserted,
                  part.size > 0, part.size <= 8 * 1_048_576,
                  part.sha256.count == 64 else {
                throw XDriveIOSUploadReconcileError.invalidResponse
            }
        }
        if snapshot.status == "active" {
            // We do NOT know the expected per-chunk digest from the ledger.
            // The next uploader must rehash the staged original and verify
            // each part before treating it as complete or sending new bytes.
            return .active(sessionID: snapshot.id, reportedChunkCount: seen.count)
        }
        guard let node = snapshot.result, node.type == "file",
              node.id > 0, node.revision > 0,
              node.name == operation.destinationName else {
            throw XDriveIOSUploadReconcileError.invalidResponse
        }
        return .finalized(sessionID: snapshot.id, nodeID: node.id, revision: node.revision)
    }
}
