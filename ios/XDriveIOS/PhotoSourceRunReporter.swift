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
        scanned += progress.scanned + progress.changeQueueProcessed
        uploaded += progress.uploaded
        verified += progress.verifiedAlready
        failed += progress.unavailable + progress.videosNotSupported +
            progress.liveNotSupported + progress.needsReview
    }
}

private enum XDriveIOSPhotoSourceRunReporterCredential {
    case foreground(XDriveIOSManagedOriginalAuthority)
    case background(XDriveIOSApprovedPhotoBGCredential)

    var sourceRunPath: String? {
        switch self {
        case .foreground(let authority):
            return "/api/v1/sources/\(authority.destination.sourceID)/runs"
        case .background(let approved):
            guard approved.hasManagedDestination,
                  let sourceID = approved.sourceID, sourceID > 0 else { return nil }
            return "/api/v1/ios/photos/background-managed/sources/\(sourceID)/runs"
        }
    }

    var owner: XDriveNativeOwnerRoot? {
        switch self {
        case .foreground(let authority):
            return authority.owner
        case .background(let approved):
            return try? approved.ownerScope()
        }
    }

    var isValid: Bool {
        switch self {
        case .foreground(let authority):
            return authority.matches(authority.owner)
        case .background(let approved):
            guard let owner = try? approved.ownerScope() else { return false }
            return approved.hasManagedDestination && approved.matches(owner)
        }
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
    private let credential: XDriveIOSPhotoSourceRunReporterCredential
    private let trigger: String
    private let runID = UUID().uuidString.lowercased()
    private var started = false
    private var finished = false
    private var progressInFlight = false
    private var lastProgressAt = Date.distantPast
    private var lastBeginAttemptAt = Date.distantPast
    private(set) var counts = XDriveIOSPhotoSourceRunCounts()
    private var progressTask: Task<Void, Never>?

    init(authority: XDriveIOSManagedOriginalAuthority, trigger: String) {
        self.credential = .foreground(authority)
        self.trigger = trigger
    }

    /// BGProcessingTask has no Web bearer. Its dedicated route accepts only
    /// the currently valid, separately revocable Owner/Device Photo Grant.
    init(approvedBackgroundGrant: XDriveIOSApprovedPhotoBGCredential,
         trigger: String) {
        self.credential = .background(approvedBackgroundGrant)
        self.trigger = trigger
    }

    func begin() async {
        await ensureStarted(force: true)
    }

    private func ensureStarted(force: Bool) async {
        guard !started, !finished,
              let basePath = credential.sourceRunPath else { return }
        let now = Date()
        guard force || now.timeIntervalSince(lastBeginAttemptAt) >= 30 else { return }
        lastBeginAttemptAt = now
        let body: [String: Any] = ["run_id": runID, "trigger": trigger]
        if let status = try? await send(
            path: basePath, method: "POST", body: body
        ), status == 200 || status == 201 {
            started = true
        }
    }

    /// The base carries completed earlier windows in a Focused Backup session.
    /// Progress reporting is coalesced and never blocks PhotoKit enumeration
    /// or original upload. finish() sends the latest cumulative counters.
    func enqueueUpdate(_ progress: XDriveIOSPhotoBackupProgress,
                       base: XDriveIOSPhotoSourceRunCounts = .init()) {
        guard !finished, let basePath = credential.sourceRunPath else { return }
        var current = base
        current.add(progress)
        counts = current
        let now = Date()
        guard !progressInFlight,
              now.timeIntervalSince(lastProgressAt) >= 2 else { return }
        lastProgressAt = now
        progressInFlight = true
        progressTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.progressInFlight = false }
            if !self.started { await self.ensureStarted(force: false) }
            guard self.started, !self.finished else { return }
            let body: [String: Any] = ["summary": self.summary(self.counts)]
            _ = try? await self.send(
                path: "\(basePath)/\(self.runID)/progress",
                method: "POST", body: body
            )
        }
    }

    func finish(status requestedStatus: String) async {
        guard !finished, let basePath = credential.sourceRunPath else { return }
        await progressTask?.value
        if !started { await ensureStarted(force: true) }
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
            path: "\(basePath)/\(self.runID)/finish",
            method: "POST", body: body
        ), result == 200 {
            finished = true
        }
    }

    /// A cancellation handler may run inside a cancelled task. Use an
    /// unstructured MainActor task so the best-effort terminal report is not
    /// immediately cancelled with the PhotoKit operation itself.
    func finishAfterCancellation(status: String) async {
        let settlement = Task { @MainActor in
            await self.finish(status: status)
        }
        await settlement.value
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
        guard credential.isValid, let owner = credential.owner,
              let canonical = try? ServerAddress.parse(owner.origin.absoluteString),
              canonical == owner.origin,
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
        configuration.timeoutIntervalForRequest = 5
        let session = URLSession(
            configuration: configuration,
            delegate: XDriveIOSPhotoSourceRunDenyRedirect(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        switch credential {
        case .foreground(let authority):
            request.setValue("Bearer " + authority.accessToken,
                             forHTTPHeaderField: "Authorization")
            request.setValue(authority.device.deviceID,
                             forHTTPHeaderField: "X-XDrive-Device-ID")
            request.setValue(authority.device.secret,
                             forHTTPHeaderField: "X-XDrive-Device-Token")
        case .background(let approved):
            request.setValue(approved.deviceID,
                             forHTTPHeaderField: "X-XDrive-Device-ID")
            request.setValue(approved.deviceToken,
                             forHTTPHeaderField: "X-XDrive-Device-Token")
            request.setValue(approved.grantSecret,
                             forHTTPHeaderField: "X-XDrive-IOS-Photo-Grant")
        }
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
