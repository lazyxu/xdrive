import AVFoundation
import Foundation
import ImageIO
import PDFKit
import UIKit

/// One read-only Owner preview contract for native Files. Never persists a
/// ticket, embeds the bearer in a URL, or downloads a video/audio into a Blob.
enum XDriveIOSNativeFilesPreviewPayload {
    case image(UIImage)
    case video(URL)
    case audio(URL)
    case pdf(PDFDocument)
    case text(String, Bool)
}

enum XDriveIOSNativeFilesPreviewError: Error {
    case unsupported
    case changed
    case invalidOwner
    case malformed
    case tooLarge
    case response(Int)
}

private struct XDriveIOSNativeFilesPreviewTicket: Decodable {
    let url: String
    let kind: String
    let mime_type: String
}

private struct XDriveIOSNativeFilesTextResponse: Decodable {
    let text: String
    let truncated: Bool
    let size: Int64
}

private final class XDriveIOSNativeFilesPreviewRejectRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

struct XDriveIOSNativeFilesPreviewReader {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func endpoint(_ path: String) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              path.hasPrefix("/api/v1/"), !path.contains("?"), !path.contains("#"),
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesPreviewError.invalidOwner
        }
        parts.path = path
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesPreviewError.invalidOwner
        }
        return url
    }

    private func relativeTicketURL(_ value: String, nodeID: UInt64) throws -> URL {
        guard XDriveIOSNativeFilesViewerPolicy.validTicketPath(value, nodeID: nodeID),
              let relative = URLComponents(string: value),
              var url = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false),
              url.scheme == "https" else {
            throw XDriveIOSNativeFilesPreviewError.malformed
        }
        url.percentEncodedPath = relative.percentEncodedPath
        url.percentEncodedQuery = relative.percentEncodedQuery
        url.fragment = nil
        guard let absolute = url.url, absolute.scheme == "https",
              absolute.host == owner.origin.host,
              absolute.port == owner.origin.port else {
            throw XDriveIOSNativeFilesPreviewError.malformed
        }
        return absolute
    }

    private func read(
        _ url: URL, method: String = "GET", authenticated: Bool = true,
        maximum: Int, expectedMIME: String? = nil
    ) async throws -> Data {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 25
        let client = URLSession(
            configuration: config, delegate: XDriveIOSNativeFilesPreviewRejectRedirect(),
            delegateQueue: nil
        )
        defer { client.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue(expectedMIME ?? "application/json", forHTTPHeaderField: "Accept")
        if authenticated {
            request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await client.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesPreviewError.malformed
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeFilesPreviewError.response(http.statusCode)
        }
        if let expectedMIME {
            let actual = (http.value(forHTTPHeaderField: "Content-Type") ?? "")
                .split(separator: ";", maxSplits: 1).first.map(String.init) ?? ""
            guard actual.lowercased() == expectedMIME.lowercased() else {
                throw XDriveIOSNativeFilesPreviewError.malformed
            }
        }
        guard data.count <= maximum else {
            throw XDriveIOSNativeFilesPreviewError.tooLarge
        }
        return data
    }

    private func verifyNode(_ selected: XDriveIOSNativeFilesNode) async throws {
        let data = try await read(
            endpoint("/api/v1/nodes/\(selected.id)"),
            maximum: 64 * 1_024
        )
        let actual = try JSONDecoder().decode(XDriveIOSNativeFilesNode.self, from: data)
        guard actual == selected else { throw XDriveIOSNativeFilesPreviewError.changed }
    }

    func preview(_ selected: XDriveIOSNativeFilesNode) async throws
        -> XDriveIOSNativeFilesPreviewPayload {
        guard XDriveIOSNativeFilesViewerPolicy.canPreview(selected) else {
            throw XDriveIOSNativeFilesPreviewError.unsupported
        }
        try await verifyNode(selected)
        let kind = XDriveIOSNativeFilesViewerPolicy.kind(for: selected.name)

        if kind == .text {
            let bytes = try await read(
                endpoint("/api/v1/files/\(selected.id)/preview/text"),
                maximum: 2 * 1_048_576
            )
            let preview = try JSONDecoder().decode(
                XDriveIOSNativeFilesTextResponse.self, from: bytes
            )
            guard preview.size == selected.size,
                  preview.text.utf8.count <= 1_048_576,
                  !preview.text.contains("\0"),
                  preview.truncated == (selected.size > 1_048_576) else {
                throw XDriveIOSNativeFilesPreviewError.malformed
            }
            try await verifyNode(selected)
            return .text(preview.text, preview.truncated)
        }

        let payload = try await read(
            endpoint("/api/v1/files/\(selected.id)/preview-ticket"),
            method: "POST", maximum: 32_768
        )
        let ticket = try JSONDecoder().decode(
            XDriveIOSNativeFilesPreviewTicket.self, from: payload
        )
        guard XDriveIOSNativeFilesViewerPolicy.validTicketType(
            kind: kind, ticketKind: ticket.kind, mime: ticket.mime_type
        ) else { throw XDriveIOSNativeFilesPreviewError.malformed }
        let url = try relativeTicketURL(ticket.url, nodeID: selected.id)
        try await verifyNode(selected)

        switch kind {
        case .video: return .video(url)
        case .audio: return .audio(url)
        case .image:
            let data = try await read(
                url, authenticated: false,
                maximum: Int(XDriveIOSNativeFilesViewerPolicy.maximumImageBytes),
                expectedMIME: ticket.mime_type
            )
            try Task.checkCancellation()
            let work = Task.detached(priority: .userInitiated) { () -> CGImage? in
                guard !Task.isCancelled, let source = CGImageSourceCreateWithData(
                    data as CFData,
                    [kCGImageSourceShouldCache: false] as CFDictionary
                ) else { return nil }
                let options: [String: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                    kCGImageSourceCreateThumbnailWithTransform as String: true,
                    kCGImageSourceThumbnailMaxPixelSize as String: 4096,
                    kCGImageSourceShouldCacheImmediately as String: false
                ]
                let decoded = CGImageSourceCreateThumbnailAtIndex(
                    source, 0, options as CFDictionary
                )
                return Task.isCancelled ? nil : decoded
            }
            let image = await withTaskCancellationHandler {
                await work.value
            } onCancel: {
                work.cancel()
            }
            try Task.checkCancellation()
            guard let image else { throw XDriveIOSNativeFilesPreviewError.malformed }
            try await verifyNode(selected)
            return .image(UIImage(cgImage: image))
        case .pdf:
            let bytes = try await read(
                url, authenticated: false,
                maximum: Int(XDriveIOSNativeFilesViewerPolicy.maximumPDFBytes),
                expectedMIME: ticket.mime_type
            )
            try Task.checkCancellation()
            guard let document = PDFDocument(data: bytes), document.pageCount > 0 else {
                throw XDriveIOSNativeFilesPreviewError.malformed
            }
            try await verifyNode(selected)
            return .pdf(document)
        case .text, .unsupported:
            throw XDriveIOSNativeFilesPreviewError.unsupported
        }
    }
}
