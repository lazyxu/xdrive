import Foundation

/// Shared SourceRun telemetry for an iPhone Push. It contains aggregate counts
/// only; PhotoKit identifiers, filenames, locations and original bytes remain
/// on the iPhone and are never sent to Source Manager.
struct XDriveIOSPhotoSourceRunCounts {
    var scanned = 0
    var uploaded = 0
    var verified = 0
    var failed = 0

    mutating func add(_ progress: XDriveIOSPhotoBackupProgress) {
        scanned += progress.scanned
        uploaded += progress.uploaded
        verified += progress.verifiedAlready
        failed += progress.unavailable + progress.videosNotSupported +
            progress.liveNotSupported + progress.needsReview
    }
}

private final class XDriveIOSPhotoSourceRunDenyRedirect:
    NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor
final class XDriveIOSPhotoSourceRunReporter {
    private let authority: XDriveIOSManagedOriginalAuthority
    private let trigger: String
    private let runID = UUID().uuidString.lowercased()
    private var started = false
    private var finished = false
    private(set) var counts = XDriveIOSPhotoSourceRunCounts()

    init(authority: XDriveIOSManagedOriginalAuthority, trigger: String) {
        self.authority = authority
        self.trigger = trigger
    }

    func begin() async {
        guard !started, !finished else { return }
        let body: [String: Any] = ["run_id": runID, "trigger": trigger]
        if let status = try? await send(
            path: "/api/v1/sources/\(authority.destination.sourceID)/runs",
            method: "POST", body: body
        ), status == 200 || status == 201 {
            started = true
        }
    }

    /// The base carries completed earlier windows in a Focused Backup session.
    /// Server counters are cumulative and monotonic across progress updates.
    func update(_ progress: XDriveIOSPhotoBackupProgress,
                base: XDriveIOSPhotoSourceRunCounts = .init()) async {
        guard !finished else { return }
        var current = base
        current.add(progress)
        counts = current
        if !started { await begin() }
        guard started else { return }
        let body: [String: Any] = ["summary": summary(current)]
        _ = try? await send(
            path: "/api/v1/sources/\(authority.destination.sourceID)/runs/\(runID)/progress",
            method: "POST", body: body
        )
    }

    func finish(status requestedStatus: String) async {
        guard !finished else { return }
        if !started { await begin() }
        guard started else { return }
        let status = requestedStatus == "completed" && counts.failed > 0
            ? "partial" : requestedStatus
        var body: [String: Any] = [
            "status": status,
            "complete_inventory": false,
            "summary": summary(counts),
        ]
        if status == "partial" && counts.failed == 0 {
            body["error"] = "PhotoKit scan ended before the bounded pass completed"
        }
        if let result = try? await send(
            path: "/api/v1/sources/\(authority.destination.sourceID)/runs/\(runID)/finish",
            method: "POST", body: body
        ), result == 200 {
            finished = true
        }
    }

    private func summary(_ value: XDriveIOSPhotoSourceRunCounts) -> [String: Any] {
        [
            "scanned_items": value.scanned,
            "scanned_bytes": 0,
            "new_items": value.uploaded,
            "new_bytes": 0,
            "unchanged_items": value.verified,
            "unchanged_bytes": 0,
            "failed_items": value.failed,
        ]
    }

    private func send(path: String, method: String,
                      body: [String: Any]) async throws -> Int {
        guard authority.matches(authority.owner),
              let canonical = try? ServerAddress.parse(authority.owner.origin.absoluteString),
              canonical == authority.owner.origin,
              var parts = URLComponents(url: canonical, resolvingAgainstBaseURL: false)
        else { throw URLError(.badURL) }
        parts.path = path
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else { throw URLError(.badURL) }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 15
        let session = URLSession(
            configuration: configuration,
            delegate: XDriveIOSPhotoSourceRunDenyRedirect(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + authority.accessToken, forHTTPHeaderField: "Authorization")
        request.setValue(authority.device.deviceID, forHTTPHeaderField: "X-XDrive-Device-ID")
        request.setValue(authority.device.secret, forHTTPHeaderField: "X-XDrive-Device-Token")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return http.statusCode
    }
}
