import AVFoundation
import Foundation
import UniformTypeIdentifiers

/// AVFoundation does not use our native URLSession router when given an HTTPS
/// URL directly. A private asset scheme forces every video/audio Range read
/// through the same strict TLS and Owner-verified LAN/WAN transport as Files.
final class XDriveIOSRoutedMediaLoader: NSObject, AVAssetResourceLoaderDelegate,
                                       @unchecked Sendable {
    enum Failure: Error {
        case invalidTicket
        case unsupportedRange
        case mismatchedRange
        case truncated
    }

    private struct ByteRange {
        let first: Int64
        let last: Int64
        let total: Int64

        static func parse(_ raw: String?) -> Self? {
            guard let raw, raw.hasPrefix("bytes ") else { return nil }
            let parts = raw.dropFirst(6).split(separator: "/", omittingEmptySubsequences: false)
            guard parts.count == 2, let total = Int64(parts[1]), total > 0 else { return nil }
            let ends = parts[0].split(separator: "-", omittingEmptySubsequences: false)
            guard ends.count == 2,
                  let first = Int64(ends[0]), let last = Int64(ends[1]),
                  first >= 0, last >= first, last < total else { return nil }
            return ByteRange(first: first, last: last, total: total)
        }
    }

    private let logicalURL: URL
    private let resourceURL: URL
    private let fallbackContentType: String
    private let queue = DispatchQueue(label: "com.lazyxu.xdrive.ios.routed-media")
    private let lock = NSLock()
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    private var retired = false
    private let session: URLSession

    init(ticketURL: URL, isAudio: Bool = false) throws {
        guard ticketURL.scheme?.lowercased() == "https",
              ticketURL.host != nil, ticketURL.user == nil,
              ticketURL.password == nil, ticketURL.fragment == nil,
              XDriveIOSAutoRoute.shared.canRoute(URLRequest(url: ticketURL)),
              var proxy = URLComponents(url: ticketURL, resolvingAgainstBaseURL: false)
        else { throw Failure.invalidTicket }
        logicalURL = ticketURL
        proxy.scheme = "xdrive-routed-media"
        guard let candidate = proxy.url else { throw Failure.invalidTicket }
        resourceURL = candidate
        fallbackContentType = isAudio ? UTType.audio.identifier : UTType.movie.identifier
        let config = XDriveIOSAutoRoute.ephemeralConfiguration()
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config,
                             delegate: XDriveIOSRoutedMediaNoRedirect(),
                             delegateQueue: nil)
        super.init()
    }

    func playerItem() -> AVPlayerItem {
        let asset = AVURLAsset(url: resourceURL)
        asset.resourceLoader.setDelegate(self, queue: queue)
        return AVPlayerItem(asset: asset)
    }

    func cancelAll() {
        lock.lock()
        retired = true
        let running = Array(tasks.values)
        tasks.removeAll()
        lock.unlock()
        for job in running { job.cancel() }
        session.invalidateAndCancel()
    }

    deinit { cancelAll() }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        guard loadingRequest.request.url == resourceURL else { return false }
        let key = ObjectIdentifier(loadingRequest)
        lock.lock()
        guard !retired else { lock.unlock(); return false }
        // Cancellation of a single seek must not cancel another data window.
        let job = Task { [weak self, weak loadingRequest] in
            guard let self, let loadingRequest else { return }
            do {
                try await self.fulfill(loadingRequest)
                try Task.checkCancellation()
                loadingRequest.finishLoading()
            } catch {
                if !Task.isCancelled { loadingRequest.finishLoading(with: error) }
            }
            self.remove(key)
        }
        tasks[key] = job
        lock.unlock()
        return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        let key = ObjectIdentifier(loadingRequest)
        lock.lock()
        let job = tasks.removeValue(forKey: key)
        lock.unlock()
        job?.cancel()
    }

    private func remove(_ key: ObjectIdentifier) {
        lock.lock()
        tasks.removeValue(forKey: key)
        lock.unlock()
    }

    private func fulfill(_ loading: AVAssetResourceLoadingRequest) async throws {
        let dataRequest = loading.dataRequest
        var offset = max(0, dataRequest?.currentOffset ?? dataRequest?.requestedOffset ?? 0)
        let allRemaining = dataRequest?.requestsAllDataToEndOfResource == true
        var remaining = Int64(max(0, dataRequest?.requestedLength ?? 1))
        if allRemaining { remaining = Int64.max }
        // Every HTTP response is a bounded 256 KiB range. Never buffer an
        // entire remote original or use unrestricted URLSession.data(for:).
        let maxPart: Int64 = 256 * 1_024
        repeat {
            try Task.checkCancellation()
            guard offset >= 0, offset < Int64.max - maxPart else {
                throw Failure.mismatchedRange
            }
            let desired = min(maxPart, max(1, remaining))
            let last = offset + desired - 1
            var forwarded = URLRequest(url: logicalURL)
            forwarded.httpMethod = "GET"
            forwarded.httpShouldHandleCookies = false
            forwarded.timeoutInterval = 30
            forwarded.setValue("bytes=\(offset)-\(last)", forHTTPHeaderField: "Range")
            forwarded.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            forwarded.setValue("no-store", forHTTPHeaderField: "Cache-Control")

            let (buffer, contentRange, contentType) = try await readSegment(
                forwarded, expectedOffset: offset, maximumEnd: last)

            if let info = loading.contentInformationRequest {
                info.contentLength = contentRange.total
                info.contentType = UTType(mimeType: contentType)?.identifier ?? fallbackContentType
                info.isByteRangeAccessSupported = true
            }
            if let dataRequest { dataRequest.respond(with: buffer) }
            offset += Int64(buffer.count)
            if remaining != Int64.max { remaining -= Int64(buffer.count) }
            if dataRequest == nil || remaining <= 0 || offset >= contentRange.total { break }
        } while true
    }

    private func readSegment(_ request: URLRequest, expectedOffset: Int64,
                             maximumEnd: Int64) async throws
                             -> (Data, ByteRange, String) {
        // The outer router may retry an untouched GET; for interrupted partial
        // ranges, retry one complete bounded segment only after Owner/route
        // validation. No partial data is delivered to the AVPlayer on failure.
        for attempt in 0...1 {
            try Task.checkCancellation()
            do {
                let (stream, response) = try await session.bytes(for: request)
                guard let http = response as? HTTPURLResponse,
                      http.statusCode == 206,
                      let span = ByteRange.parse(http.value(forHTTPHeaderField: "Content-Range")),
                      span.first == expectedOffset, span.last <= maximumEnd,
                      let size = Int(exactly: span.last - span.first + 1),
                      size > 0, size <= 256 * 1_024,
                      let encoding = http.value(forHTTPHeaderField: "Content-Encoding"),
                      encoding.lowercased() == "identity"
                        || http.value(forHTTPHeaderField: "Content-Encoding") == nil
                else { throw Failure.unsupportedRange }
                var output = Data()
                output.reserveCapacity(size)
                for try await byte in stream {
                    try Task.checkCancellation()
                    guard output.count < size else { throw Failure.mismatchedRange }
                    output.append(byte)
                }
                guard output.count == size else { throw Failure.truncated }
                return (output, span, http.mimeType ?? "application/octet-stream")
            } catch {
                guard attempt == 0, XDriveIOSAutoRouteSafety.isNetworkFailure(error),
                      !Task.isCancelled else { throw error }
                await XDriveIOSAutoRoute.shared.revalidateRoutes()
            }
        }
        throw Failure.truncated
    }
}

/// Never follow a ticket to another host, and use the existing pinned IP-CA
/// and system-domain TLS policy. The signed file-preview query is not logged.
private final class XDriveIOSRoutedMediaNoRedirect:
    XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
