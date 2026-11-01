import Foundation
import ImageIO
import SwiftUI
import UIKit

private enum XDriveIOSNativeFilesThumbnailFailure: Error {
    case invalidOwner
    case invalidResponse
}

/// One shared, cancellation-aware admission gate for Files tiles. A Viewer
/// preempts tiles by changing their task identity; no 64-request fan-out.
private final class XDriveIOSNativeFilesThumbnailDenyRedirect:
    NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// A Server-derived thumbnail/poster only. Never request file preview tickets,
/// original content or CAS bytes from a Files list/grid thumbnail.
struct XDriveIOSNativeFilesThumbnailReader {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    func thumbnail(_ node: XDriveIOSNativeFilesNode) async throws -> UIImage {
        guard XDriveIOSNativeFilesThumbnailPolicy.canRequest(node),
              owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesThumbnailFailure.invalidOwner
        }
        parts.path = "/api/v1/media/items/\(node.id)/thumbnail"
        parts.queryItems = [
            URLQueryItem(name: "v", value: "4"),
            URLQueryItem(name: "revision", value: String(node.revision))
        ]
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesThumbnailFailure.invalidOwner
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 25
        let session = URLSession(
            configuration: config,
            delegate: XDriveIOSNativeFilesThumbnailDenyRedirect(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("image/jpeg, image/png", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              XDriveIOSNativeFilesThumbnailPolicy.acceptedMIME(
                http.value(forHTTPHeaderField: "Content-Type")
              ),
              data.count > 0,
              data.count <= XDriveIOSNativeFilesThumbnailPolicy.maximumBytes
        else { throw XDriveIOSNativeFilesThumbnailFailure.invalidResponse }
        let worker = Task.detached(priority: .utility) { () -> CGImage? in
            guard !Task.isCancelled,
                  let source = CGImageSourceCreateWithData(
                    data as CFData,
                    [kCGImageSourceShouldCache: false] as CFDictionary
                  ) else { return nil }
            let options: [String: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                kCGImageSourceCreateThumbnailWithTransform as String: true,
                kCGImageSourceThumbnailMaxPixelSize as String:
                    XDriveIOSNativeFilesThumbnailPolicy.maximumPixelEdge,
                kCGImageSourceShouldCacheImmediately as String: false
            ]
            let decoded = CGImageSourceCreateThumbnailAtIndex(
                source, 0, options as CFDictionary
            )
            return Task.isCancelled ? nil : decoded
        }
        let thumbnail = await withTaskCancellationHandler {
            await worker.value
        } onCancel: {
            worker.cancel()
        }
        try Task.checkCancellation()
        guard let thumbnail else {
            throw XDriveIOSNativeFilesThumbnailFailure.invalidResponse
        }
        return UIImage(cgImage: thumbnail)
    }
}

private struct XDriveIOSNativeFilesThumbnailIdentity: Hashable {
    let nodeID: UInt64
    let revision: UInt64
    let serverOrigin: URL?
    let instanceID: String?
    let ownerID: UInt64?
    let rootNodeID: UInt64?
    let visible: Bool
}

/// Visibility-driven thumbnail tile: a failed/unsupported derivative leaves
/// the native file icon. No original fallback, no cached stale cross-owner art.
struct XDriveIOSNativeFilesThumbnailTile: View {
    let node: XDriveIOSNativeFilesNode
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let height: CGFloat
    var width: CGFloat? = nil
    var viewerActive = false

    @Environment(\.scenePhase) private var phase
    @State private var bitmap: UIImage?

    private var identity: XDriveIOSNativeFilesThumbnailIdentity {
        let owner = login.owner
        return .init(
            nodeID: node.id, revision: node.revision,
            serverOrigin: owner?.origin, instanceID: owner?.instanceID,
            ownerID: owner?.ownerID, rootNodeID: owner?.rootNodeID,
            visible: !viewerActive && phase == .active
        )
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.accentColor.opacity(0.07))
            if let bitmap {
                Image(uiImage: bitmap)
                    .resizable()
                    .scaledToFill()
                    .frame(width: width, height: height)
                    .clipped()
            } else {
                Image(systemName: node.isDirectory ? "folder.fill" :
                    XDriveIOSNativeFilesThumbnailPolicy.isVideo(node) ? "video.fill" :
                    XDriveIOSNativeFilesThumbnailPolicy.canRequest(node) ? "photo" : "doc")
                    .font(.system(size: min(32, max(18, height * 0.46))))
                    .foregroundStyle(node.isDirectory ? Color.accentColor : Color.secondary)
            }
        }
        .frame(width: width, height: height)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityHidden(true)
        .task(id: identity) {
            bitmap = nil
            guard identity.visible,
                  XDriveIOSNativeFilesThumbnailPolicy.canRequest(node),
                  let expected = login.owner else { return }
            do {
                let image = try await XDriveIOSNativeFilesThumbnailSlots.shared.perform {
                    let auth = try await login.verifiedAuthorization()
                    try Task.checkCancellation()
                    guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                    else { throw XDriveIOSNativeFilesThumbnailFailure.invalidOwner }
                    return try await XDriveIOSNativeFilesThumbnailReader(
                        owner: auth.owner, accessToken: auth.accessToken
                    ).thumbnail(node)
                }
                try Task.checkCancellation()
                guard !viewerActive, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                bitmap = image
            } catch {
                // No derivative (e.g. cold video poster) is not an absent file.
                // Keep the native icon; never load the original as fallback.
            }
        }
        .onDisappear { bitmap = nil }
    }
}
