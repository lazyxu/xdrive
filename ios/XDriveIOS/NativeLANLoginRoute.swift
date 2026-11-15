import Foundation

/// Select one HTTPS endpoint anonymously BEFORE login. There is intentionally
/// no runtime DNS override, certificate bypass, post-login route switching or
/// replay of credential-bearing requests after failure.
enum XDriveIOSNativeLANLoginRoute {
    /// Only canonical RFC1918 IPv4 is accepted. The configured HTTPS server's
    /// original port is retained; an IP is never interpreted as a new URL.
    static func candidate(origin: URL, ip input: String) throws -> URL? {
        // Hidden control characters are invalid, not quietly trimmed into
        // an apparently canonical address before a credential-bearing login.
        guard !input.unicodeScalars.contains(where: {
            CharacterSet.controlCharacters.contains($0)
        }) else { throw AuthFailure.invalidLANIP }
        let input = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if input.isEmpty { return nil }
        guard XDriveIOSLANAuthority(ip: input, port: origin.port ?? 443) != nil,
              let host = origin.host, !host.isEmpty,
              !host.contains(":"), !host.allSatisfy({ $0.isNumber || $0 == "." }),
              var url = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              url.scheme?.lowercased() == "https", url.user == nil,
              url.password == nil, url.percentEncodedQuery == nil,
              url.fragment == nil else { throw AuthFailure.invalidLANIP }
        url.host = input
        url.path = ""
        guard let target = url.url else { throw AuthFailure.invalidLANIP }
        return try ServerAddress.parse(target.absoluteString)
    }

    static func selectOrigin(origin: URL, lanIP: String) async throws -> URL {
        try await selectOrigin(origin: origin, lanIP: lanIP) { local in
            if let target = XDriveIOSLANAuthority(url: local),
               let pairing = try XDriveIOSLANPairingStore.load(target),
               pairing.domain != XDriveIOSLANPairing.publicDomain(origin) {
                throw XDriveIOSLANPairingFailure.differentDomain
            }
            try await probeVersion(local, mode: .storedPairings)
        }
    }

    /// An injectable, credential-free probe makes the fallback policy testable
    /// with no live xDrive Server and no TLS/hostname validation overrides.
    static func selectOrigin(
        origin: URL, lanIP: String,
        probe: (URL) async throws -> Void
    ) async throws -> URL {
        guard let local = try candidate(origin: origin, ip: lanIP) else { return origin }
        try Task.checkCancellation()
        do {
            try await probe(local)
            try Task.checkCancellation()
            return local
        } catch {
            try Task.checkCancellation()
            // Only a NETWORK failure in this anonymous probe permits fallback.
            // TLS/IP SAN, redirect, HTTP, malformed response and cancellation
            // must fail closed before any password or refresh token is sent.
            if let failure = error as? URLError,
               [.cannotConnectToHost, .timedOut, .networkConnectionLost,
                .notConnectedToInternet, .cannotFindHost].contains(failure.code) {
                return origin
            }
            throw error
        }
    }

    /// Reuse the Desktop bootstrap: direct LAN dial, system-verified DNS name,
    /// then independently verify the IP endpoint under that exact CA.
    static func verifyPairing(origin: URL, lanIP: String) async throws -> (XDriveIOSLANAuthority, XDriveIOSLANPairing) {
        guard let domain = XDriveIOSLANPairing.publicDomain(origin),
              let local = try candidate(origin: origin, ip: lanIP),
              let target = XDriveIOSLANAuthority(url: local) else {
            throw XDriveIOSLANPairingFailure.invalidAuthority
        }
        if let old = try XDriveIOSLANPairingStore.load(target), old.domain != domain {
            throw XDriveIOSLANPairingFailure.differentDomain
        }
        let pem: Data
        do {
            pem = try await XDriveIOSLANCertificateBootstrap.fetch(origin: origin, target: target)
        } catch {
            try Task.checkCancellation()
            // Keep the bounded, credential-free bootstrap's specific stage.
            // Previously every network/TLS/permission error looked like a
            // missing Caddy root, even when the endpoint itself was healthy.
            throw (error as? XDriveIOSLANPairingFailure) ?? .connectionUnavailable(0)
        }
        guard let der = XDriveIOSLANPairing.rootDER(from: pem) else {
            throw XDriveIOSLANPairingFailure.invalidRoot
        }
        do {
            try await probeVersion(local, mode: .verifyingPairing(target, der), pairing: true)
        } catch {
            try Task.checkCancellation()
            // NEVER describe a timeout, redirect, non-200/HTML /version
            // response or URLSession transport failure as an invalid CA.
            // Only the actual SecTrust rejection is an IP certificate error.
            throw pairingProbeFailure(error)
        }
        return (target, XDriveIOSLANPairing(domain: domain, rootDER: der))
    }

    /// Only fixed, non-secret categories and OS numbers are exposed to the
    /// user. No URL, response body, token or arbitrary localized description.
    static func pairingProbeFailure(_ error: Error) -> XDriveIOSLANPairingFailure {
        if let known = error as? XDriveIOSLANPairingFailure { return known }
        if let url = error as? URLError {
            switch url.code {
            case .timedOut:
                return .ipConnectionTimedOut
            case .secureConnectionFailed:
                // A TLS handshake can fail BEFORE any server-trust challenge.
                // Do not invent an IP SAN/CA failure without explicit evidence.
                return .ipTLSHandshakeFailed(url.errorCode)
            case .serverCertificateUntrusted, .serverCertificateHasBadDate,
                 .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot:
                // No captured rejection means URLSession reported a TLS error
                // without a usable serverTrust challenge. Do not claim CA/SAN.
                return .ipCertificateWithoutChallenge(url.errorCode)
            default:
                return .ipConnectionUnavailable(url.errorCode)
            }
        }
        if let failure = error as? AuthFailure {
            switch failure {
            case .redirectRefused: return .ipVersionRedirect
            case .invalidLANProbe: return .ipVersionInvalid
            default: return .ipVersionInvalid
            }
        }
        return .ipVersionInvalid
    }

    // Internal for the exact product-path iPhone Simulator TLS regression.
    static func probeVersion(
        _ origin: URL, mode: XDriveIOSServerTLSDelegate.TrustMode,
        pairing: Bool = false
    ) async throws {
        // Pairing is user-initiated and may include the FIRST local network
        // permission/TLS handshake. Its old 3-second limit could mislabel a
        // slow but healthy IP endpoint as a certificate mismatch.
        let timeout: TimeInterval = pairing ? 8 : 3
        let data = try await read(origin, path: "/api/v1/version", mode: mode,
                                  mimeType: "application/json", maxBytes: 16_384,
                                  timeout: timeout, pairing: pairing)
        guard let json = try? JSONDecoder().decode(XDriveIOSLANVersion.self, from: data),
              !json.version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              json.version.utf8.count <= 256 else {
            if pairing { throw XDriveIOSLANPairingFailure.ipVersionInvalid }
            throw AuthFailure.invalidLANProbe
        }
    }

    private static func read(_ origin: URL, path: String, mode: XDriveIOSServerTLSDelegate.TrustMode,
                             mimeType: String, maxBytes: Int, timeout: TimeInterval,
                             pairing: Bool) async throws -> Data {
        guard var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
            throw AuthFailure.invalidLANProbe
        }
        parts.path = path
        guard let url = parts.url else { throw AuthFailure.invalidLANProbe }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.timeoutInterval = timeout
        request.setValue(mimeType, forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.urlCredentialStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout + 1
        let verifier = XDriveIOSLANProbeRejectRedirects(mode: mode)
        let session = URLSession(configuration: config, delegate: verifier, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            // The installed iPhone reported -1202 with no recorded rejecting
            // challenge on the previous async bytes(for:) probe. Use a real
            // URLSession dataTask with a bounded URLSessionDataDelegate instead:
            // it follows the same TLS callback path as native URLSession tasks,
            // and rejects overlong content before buffering unbounded bytes.
            let invalidBody: Error = pairing
                ? XDriveIOSLANPairingFailure.ipVersionInvalid : AuthFailure.invalidLANProbe
            let (data, response) = try await verifier.boundedRead(
                request: request, session: session, maxBytes: maxBytes,
                overLimitError: invalidBody
            )
            try Task.checkCancellation()
            guard let http = response as? HTTPURLResponse else {
                if pairing { throw XDriveIOSLANPairingFailure.ipVersionInvalid }
                throw AuthFailure.invalidLANProbe
            }
            if (300..<400).contains(http.statusCode) {
                if pairing { throw XDriveIOSLANPairingFailure.ipVersionRedirect }
                throw AuthFailure.redirectRefused
            }
            if http.statusCode != 200 {
                if pairing { throw XDriveIOSLANPairingFailure.ipVersionStatus(http.statusCode) }
                throw AuthFailure.invalidLANProbe
            }
            guard http.url == url, http.mimeType == mimeType,
                  http.expectedContentLength <= Int64(maxBytes) else {
                if pairing { throw XDriveIOSLANPairingFailure.ipVersionInvalid }
                throw AuthFailure.invalidLANProbe
            }
            guard data.count <= maxBytes else {
                if pairing { throw XDriveIOSLANPairingFailure.ipVersionInvalid }
                throw AuthFailure.invalidLANProbe
            }
            return data
        } catch {
            try Task.checkCancellation()
            // URLSession may surface an authentication-challenge rejection
            // as NSURLErrorCancelled (-999), rather than a certificate code.
            // Only a recorded trust rejection is diagnosed as IP TLS failure.
            if verifier.rejectedServerTrust {
                if pairing, let evidence = verifier.pairingEvidence {
                    throw XDriveIOSLANPairingFailure.ipCertificateEvidence(evidence)
                }
                if pairing {
                    switch verifier.trustRejection {
                    case .ipIdentityOrServerUsageMismatch:
                        throw XDriveIOSLANPairingFailure.ipCertificateIdentityInvalid
                    case .chainOrValidityMismatch:
                        throw XDriveIOSLANPairingFailure.ipCertificateChainInvalid
                    default:
                        throw XDriveIOSLANPairingFailure.ipCertificateInvalid
                    }
                }
                throw URLError(.serverCertificateUntrusted)
            }
            // Do not label this a missing challenge: Apple may accept the
            // strict pinned CA/IP identity first and still return -1202 at
            // a later CFNetwork stage. Report that case separately.
            if pairing, verifier.acceptedServerTrust, let url = error as? URLError,
               [.serverCertificateUntrusted, .serverCertificateHasBadDate,
                .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot]
                  .contains(url.code) {
                throw XDriveIOSLANPairingFailure.ipCertificatePostTrustFailure(url.errorCode)
            }
            throw error
        }
    }
}

private struct XDriveIOSLANVersion: Decodable { let version: String }

/// Anonymous, single-task IP /version read. It shares the *same* strict
/// pinned-CA trust decision as normal native transport. No password, bearer
/// credential, TLS bypass or DNS fallback is allowed on this request.
private final class XDriveIOSLANProbeRejectRedirects: XDriveIOSServerTLSDelegate,
    URLSessionDataDelegate, @unchecked Sendable {
    private let stateLock = NSLock()
    private var trustWasRejected = false
    private var trustWasAccepted = false
    private var lastTrustRejection: XDriveIOSLANTrustVerdict?
    private var lastPairingEvidence: XDriveIOSLANTrustEvidence?

    // The URLSessionDataDelegate owns a single bounded read. Mutable state is
    // protected because cancellation and URLSession callbacks may race.
    private var continuation: CheckedContinuation<(Data, URLResponse), Error>?
    private var activeTask: URLSessionDataTask?
    private var receivedResponse: URLResponse?
    private var receivedBytes = Data()
    private var maximumBytes = 0
    private var overLimitFailure: Error = AuthFailure.invalidLANProbe
    private var cancelled = false

    var pairingEvidence: XDriveIOSLANTrustEvidence? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return lastPairingEvidence
    }

    var rejectedServerTrust: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return trustWasRejected
    }

    var acceptedServerTrust: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return trustWasAccepted
    }

    var trustRejection: XDriveIOSLANTrustVerdict? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return lastTrustRejection
    }

    override func observedTrustRejection(_ verdict: XDriveIOSLANTrustVerdict) {
        stateLock.lock()
        lastTrustRejection = verdict
        stateLock.unlock()
    }

    override func observedPairingEvidence(_ evidence: XDriveIOSLANTrustEvidence) {
        stateLock.lock()
        lastPairingEvidence = evidence
        stateLock.unlock()
    }

    func boundedRead(request: URLRequest, session: URLSession, maxBytes: Int,
                     overLimitError: Error) async throws -> (Data, URLResponse) {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { pending in
                let task = session.dataTask(with: request)
                stateLock.lock()
                if cancelled {
                    stateLock.unlock()
                    pending.resume(throwing: CancellationError())
                    return
                }
                continuation = pending
                activeTask = task
                maximumBytes = maxBytes
                overLimitFailure = overLimitError
                stateLock.unlock()
                task.resume()
            }
        } onCancel: {
            cancelActiveTask()
        }
    }

    private func cancelActiveTask() {
        stateLock.lock()
        cancelled = true
        let task = activeTask
        stateLock.unlock()
        task?.cancel()
        finish(.failure(CancellationError()))
    }

    private func finish(_ result: Result<(Data, URLResponse), Error>) {
        stateLock.lock()
        let pending = continuation
        continuation = nil
        activeTask = nil
        stateLock.unlock()
        pending?.resume(with: result)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        stateLock.lock()
        let active = continuation != nil
        let tooLarge = response.expectedContentLength > Int64(maximumBytes)
        if active && !tooLarge { receivedResponse = response }
        let failure = overLimitFailure
        stateLock.unlock()
        guard active else { completionHandler(.cancel); return }
        if tooLarge {
            completionHandler(.cancel)
            finish(.failure(failure))
            dataTask.cancel()
        } else {
            completionHandler(.allow)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive data: Data) {
        stateLock.lock()
        let active = continuation != nil
        let overLimit = active && data.count > maximumBytes - receivedBytes.count
        if active && !overLimit { receivedBytes.append(data) }
        let failure = overLimitFailure
        stateLock.unlock()
        if overLimit {
            finish(.failure(failure))
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        stateLock.lock()
        let response = receivedResponse
        let data = receivedBytes
        stateLock.unlock()
        if let error {
            finish(.failure(error))
        } else if let response {
            finish(.success((data, response)))
        } else {
            finish(.failure(AuthFailure.invalidLANProbe))
        }
    }

    // A task-specific challenge is forwarded to the same strict root/IP trust
    // inspector; the session-level challenge remains supported on Apple OSes
    // that invoke URLSessionDelegate for serverTrust.
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        urlSession(session, didReceive: challenge, completionHandler: completionHandler)
    }

    override func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                             completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let isServerTrust =
            challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust
        super.urlSession(session, didReceive: challenge) { [weak self] disposition, credential in
            if isServerTrust, let self {
                self.stateLock.lock()
                if disposition == .cancelAuthenticationChallenge {
                    self.trustWasRejected = true
                } else if disposition == .useCredential {
                    self.trustWasAccepted = true
                }
                self.stateLock.unlock()
            }
            completionHandler(disposition, credential)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
