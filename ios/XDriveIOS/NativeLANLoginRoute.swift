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
            case .secureConnectionFailed, .serverCertificateUntrusted,
                 .serverCertificateHasBadDate, .serverCertificateNotYetValid,
                 .serverCertificateHasUnknownRoot:
                return .ipCertificateInvalid
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

    private static func probeVersion(
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
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch {
            try Task.checkCancellation()
            // URLSession may surface an explicit authentication-challenge
            // rejection as NSURLErrorCancelled (-999), rather than the
            // certificate-specific error. Record only the trust callback's
            // disposition, not untrusted message text or certificate bytes.
            if verifier.rejectedServerTrust {
                if pairing { throw XDriveIOSLANPairingFailure.ipCertificateInvalid }
                throw URLError(.serverCertificateUntrusted)
            }
            throw error
        }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
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
        var data = Data()
        for try await byte in bytes {
            guard data.count < maxBytes else {
                if pairing { throw XDriveIOSLANPairingFailure.ipVersionInvalid }
                throw AuthFailure.invalidLANProbe
            }
            data.append(byte)
        }
        return data
    }
}

private struct XDriveIOSLANVersion: Decodable { let version: String }

private final class XDriveIOSLANProbeRejectRedirects: XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    private let stateLock = NSLock()
    private var trustWasRejected = false

    var rejectedServerTrust: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return trustWasRejected
    }

    override func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                             completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        super.urlSession(session, didReceive: challenge) { [weak self] disposition, credential in
            if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust &&
                disposition == .cancelAuthenticationChallenge {
                self?.stateLock.lock()
                self?.trustWasRejected = true
                self?.stateLock.unlock()
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
