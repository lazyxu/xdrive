import Foundation

enum XDriveIOSNativeFilesCreateError: Error {
    case invalidName
    case invalidOwner
    case server(Int)
    case invalidReply
}

private struct XDriveIOSNativeCreatedDirectory: Decodable {
    let id: UInt64
    let parent_id: UInt64?
    let name: String
    let type: String
    let revision: UInt64
}

private final class XDriveIOSFilesDenyMutationRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// One explicit foreground Owner-scoped directory POST. A cancellation or
/// lost response is uncertain, never a signal to silently repeat the write.
struct XDriveIOSNativeFilesDirectoryCreator {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    func create(parentID: UInt64, name: String) async throws -> UInt64 {
        guard parentID > 0,
              !accessToken.isEmpty,
              owner.ownerID > 0, owner.rootNodeID > 0, !owner.instanceID.isEmpty,
              let accepted = XDriveIOSNativeFilesFolderNamePolicy.normalized(name),
              accepted == name,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesCreateError.invalidOwner
        }
        parts.path = "/api/v1/nodes/\(parentID)/directories"
        guard let url = parts.url else { throw XDriveIOSNativeFilesCreateError.invalidOwner }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 25
        let session = URLSession(configuration: config,
                                 delegate: XDriveIOSFilesDenyMutationRedirects(),
                                 delegateQueue: nil)
        defer { session.invalidateAndCancel() }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.httpBody = try JSONEncoder().encode(["name": name])
        try Task.checkCancellation()
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesCreateError.invalidReply
        }
        guard http.statusCode == 201 else {
            throw XDriveIOSNativeFilesCreateError.server(http.statusCode)
        }
        guard data.count <= 65_536,
              let saved = try? JSONDecoder().decode(XDriveIOSNativeCreatedDirectory.self,
                                                    from: data),
              saved.id > 0, saved.revision > 0,
              saved.type == "dir",
              saved.name == name,
              saved.parent_id == parentID else {
            throw XDriveIOSNativeFilesCreateError.invalidReply
        }
        return saved.id
    }
}
