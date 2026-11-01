import Combine
import Foundation

enum XDriveIOSNativeFilesBatchTargetError: Error {
    case invalidSelection
    case invalidOwner
    case targetChanged
    case malformedReceipt
    case server(Int)
}

private final class XDriveIOSNativeBatchTargetDenyRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct XDriveIOSNativeBatchNodeRef: Encodable {
    let id: UInt64
    let revision: UInt64
}

private struct XDriveIOSNativeBatchTargetRequest: Encodable {
    let items: [XDriveIOSNativeBatchNodeRef]
    let parent_id: UInt64
}

/// One existing Go transaction for one verified 64-item Files page; not 64
/// independent best-effort mutations. Never retry a lost POST acknowledgment.
private struct XDriveIOSNativeFilesBatchTargetWriter {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    func perform(
        _ kind: XDriveIOSNativeFilesDestinationKind,
        items: [XDriveIOSNativeFilesNode],
        sourceParentID: UInt64,
        destination: XDriveIOSNativeFilesDestination
    ) async throws {
        guard XDriveIOSNativeFilesBatchTargetPolicy.validSelection(
            items, sourceParentID: sourceParentID,
            destinationID: destination.id, kind: kind
        ) else { throw XDriveIOSNativeFilesBatchTargetError.invalidSelection }

        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var base = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              base.scheme == "https" else {
            throw XDriveIOSNativeFilesBatchTargetError.invalidOwner
        }
        base.path = "/api/v1/nodes/\(destination.id)"
        base.query = nil
        base.fragment = nil
        guard let targetURL = base.url else {
            throw XDriveIOSNativeFilesBatchTargetError.invalidOwner
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        let session = URLSession(
            configuration: config, delegate: XDriveIOSNativeBatchTargetDenyRedirects(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }

        var targetRequest = URLRequest(url: targetURL)
        targetRequest.httpMethod = "GET"
        targetRequest.httpShouldHandleCookies = false
        targetRequest.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        targetRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        targetRequest.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (metadata, targetResponse) = try await session.data(for: targetRequest)
        try Task.checkCancellation()
        guard let targetHTTP = targetResponse as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesBatchTargetError.malformedReceipt
        }
        guard targetHTTP.statusCode == 200 else {
            throw XDriveIOSNativeFilesBatchTargetError.server(targetHTTP.statusCode)
        }
        guard metadata.count <= 65_536,
              let node = try? JSONDecoder().decode(
                XDriveIOSNativeFilesNode.self, from: metadata
              ),
              node.id == destination.id, node.revision > 0,
              node.type == "dir",
              (destination.id == owner.rootNodeID
                ? node.parent_id == nil
                : node.parent_id != nil && node.name == destination.name) else {
            throw XDriveIOSNativeFilesBatchTargetError.targetChanged
        }
        // The Server transaction rechecks every selected Owner Node revision,
        // subtree protection, target validity and cycle exclusion.
        try Task.checkCancellation()
        base.path = kind == .copy
            ? "/api/v1/nodes/batch/copy"
            : "/api/v1/nodes/batch/move"
        guard let operationURL = base.url else {
            throw XDriveIOSNativeFilesBatchTargetError.invalidOwner
        }
        var request = URLRequest(url: operationURL)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.httpBody = try JSONEncoder().encode(
            XDriveIOSNativeBatchTargetRequest(
                items: items.map {
                    XDriveIOSNativeBatchNodeRef(id: $0.id, revision: $0.revision)
                },
                parent_id: destination.id
            )
        )

        let (body, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesBatchTargetError.malformedReceipt
        }
        let expectedStatus = kind == .copy ? 201 : 200
        guard http.statusCode == expectedStatus else {
            throw XDriveIOSNativeFilesBatchTargetError.server(http.statusCode)
        }
        guard body.count <= 262_144,
              let receipt = try? JSONDecoder().decode(
                XDriveIOSNativeFilesBatchTargetReceipt.self, from: body
              ),
              XDriveIOSNativeFilesBatchTargetPolicy.validReceipt(
                receipt, original: items, sourceParentID: sourceParentID,
                destinationID: destination.id, kind: kind
              ) else {
            throw XDriveIOSNativeFilesBatchTargetError.malformedReceipt
        }
    }
}

/// The model owns only the foreground single-batch operation. It reports
/// uncertain status after a lost ACK and never blindly resubmits a POST.
@MainActor
final class XDriveIOSNativeFilesBatchTargetModel: ObservableObject {
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
        status = "已请求取消；若服务器已提交批量操作，结果仍需在云端核对。"
    }

    func perform(
        _ kind: XDriveIOSNativeFilesDestinationKind,
        items: [XDriveIOSNativeFilesNode],
        sourceParentID: UInt64,
        destination: XDriveIOSNativeFilesDestination,
        login: XDriveIOSNativeOwnerLoginModel,
        onConfirmed: @MainActor @escaping () -> Void
    ) {
        guard !busy, running == nil, let expectedOwner = login.owner,
              XDriveIOSNativeFilesBatchTargetPolicy.validSelection(
                items, sourceParentID: sourceParentID,
                destinationID: destination.id, kind: kind
              ) else {
            status = "选择已失效，请刷新当前目录后重选。"
            return
        }
        let ticket = UUID()
        generation = ticket
        busy = true
        status = "正在验证 \(items.count) 项和目标文件夹…"
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
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expectedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
                else { throw XDriveIOSNativeFilesBatchTargetError.invalidOwner }

                try await XDriveIOSNativeFilesBatchTargetWriter(
                    owner: auth.owner, accessToken: auth.accessToken
                ).perform(
                    kind, items: items, sourceParentID: sourceParentID,
                    destination: destination
                )
                try Task.checkCancellation()
                let after = try await login.verifiedAuthorization()
                guard generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(after.owner, expectedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
                else { return }
                status = kind == .copy
                    ? "服务器已确认 \(items.count) 项复制，正在刷新列表。"
                    : "服务器已确认 \(items.count) 项移动，正在刷新列表。"
                onConfirmed()
            } catch is CancellationError {
                if generation == ticket {
                    status = "本次已取消；如果请求已发出，请先核对目标目录，勿盲目重试。"
                }
            } catch {
                guard generation == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesBatchTargetError {
                    switch failure {
                    case .server(400), .server(409), .server(412),
                         .invalidSelection, .targetChanged:
                        status = "版本或目标文件夹已变化；请刷新并重新选择。"
                    case .server(401), .server(403), .server(404), .invalidOwner:
                        status = "Owner 或目标文件夹权限已变化，操作未获确认。"
                    default:
                        status = "批量复制/移动结果未确认，请先核对云端，不要自动重试。"
                    }
                } else {
                    status = "批量复制/移动结果未确认，请先核对云端，不要自动重试。"
                }
            }
        }
    }
}
