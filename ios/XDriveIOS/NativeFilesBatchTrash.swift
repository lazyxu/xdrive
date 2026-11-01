import Combine
import Foundation

enum XDriveIOSNativeFilesBatchTrashError: Error {
    case invalidSelection
    case invalidOwner
    case malformedReceipt
    case server(Int)
}

private final class XDriveIOSNativeFilesBatchTrashNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct XDriveIOSNativeFilesBatchTrashRef: Encodable {
    let id: UInt64
    let revision: UInt64
}

private struct XDriveIOSNativeFilesBatchTrashRequest: Encodable {
    let items: [XDriveIOSNativeFilesBatchTrashRef]
}

private struct XDriveIOSNativeFilesBatchTrashWriter {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    func trash(_ items: [XDriveIOSNativeFilesNode],
               parentID: UInt64) async throws {
        guard XDriveIOSNativeFilesBatchTrashPolicy.validSelection(items, parentID: parentID)
        else { throw XDriveIOSNativeFilesBatchTrashError.invalidSelection }
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesBatchTrashError.invalidOwner
        }
        parts.path = "/api/v1/nodes/batch/delete"
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else { throw XDriveIOSNativeFilesBatchTrashError.invalidOwner }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        let session = URLSession(configuration: config,
                                 delegate: XDriveIOSNativeFilesBatchTrashNoRedirects(),
                                 delegateQueue: nil)
        defer { session.invalidateAndCancel() }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.httpBody = try JSONEncoder().encode(
            XDriveIOSNativeFilesBatchTrashRequest(
                items: items.map {
                    XDriveIOSNativeFilesBatchTrashRef(id: $0.id, revision: $0.revision)
                }
            )
        )
        try Task.checkCancellation()
        let (body, reply) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = reply as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesBatchTrashError.malformedReceipt
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeFilesBatchTrashError.server(http.statusCode)
        }
        guard body.count <= 65_536,
              let receipt = try? JSONDecoder().decode(
                XDriveIOSNativeFilesBatchTrashReceipt.self, from: body
              ),
              XDriveIOSNativeFilesBatchTrashPolicy.validReceipt(receipt, for: items)
        else { throw XDriveIOSNativeFilesBatchTrashError.malformedReceipt }
    }
}

@MainActor
final class XDriveIOSNativeFilesBatchTrashModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var status: String?
    private var generation = UUID()
    private var running: Task<Void, Never>?

    func invalidate() {
        generation = UUID()
        running?.cancel()
        running = nil
        busy = false
        status = nil
    }

    func cancelCurrent() {
        guard busy, let running else { return }
        running.cancel()
        status = "已请求取消；如果批量请求已提交，须刷新目录核对，不能盲目重试。"
    }

    func trash(_ items: [XDriveIOSNativeFilesNode],
               parentID: UInt64,
               login: XDriveIOSNativeOwnerLoginModel,
               onConfirmed: @MainActor @escaping () -> Void) {
        guard !busy, running == nil,
              let expected = login.owner,
              XDriveIOSNativeFilesBatchTrashPolicy.validSelection(items, parentID: parentID)
        else {
            status = "当前选择无效，请重新选择本页文件。"
            return
        }
        let ticket = UUID()
        generation = ticket
        busy = true
        status = "正在确认 \(items.count) 项的服务器版本和回收站操作…"
        running = Task { @MainActor in
            defer {
                if generation == ticket {
                    busy = false
                    running = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { throw XDriveIOSNativeFilesBatchTrashError.invalidOwner }
                try await XDriveIOSNativeFilesBatchTrashWriter(
                    owner: auth.owner, accessToken: auth.accessToken
                ).trash(items, parentID: parentID)
                try Task.checkCancellation()
                let after = try await login.verifiedAuthorization()
                guard generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(after.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                status = "服务器已确认 \(items.count) 项进入回收站，正在刷新目录。"
                onConfirmed()
            } catch is CancellationError {
                if generation == ticket {
                    status = "已取消当前任务。如果请求已提交，结果可能不确定，请刷新目录核对。"
                }
            } catch {
                guard generation == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesBatchTrashError {
                    switch failure {
                    case .server(409), .server(412), .invalidSelection:
                        status = "部分文件版本已变化，服务器拒绝提交；请刷新后重新选择。"
                    case .server(401), .server(403), .server(404), .invalidOwner:
                        status = "当前账户或文件夹已变化，请重新验证后操作。"
                    default:
                        status = "批量操作结果未确认，请先刷新核对，勿盲目重试。"
                    }
                } else {
                    status = "批量操作结果未确认，请先刷新核对，勿盲目重试。"
                }
            }
        }
    }
}
