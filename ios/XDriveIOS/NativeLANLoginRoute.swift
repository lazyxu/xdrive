import Foundation

/// Select one HTTPS endpoint anonymously BEFORE login. There is intentionally
/// no runtime DNS override, certificate bypass, post-login route switching or
/// replay of credential-bearing requests after failure.
enum XDriveIOSNativeLANLoginRoute {
    /// Only canonical RFC1918 IPv4 is accepted. The configured HTTPS server's
    /// original port is retained; an IP is never interpreted as a new URL.
    static func candidate(origin: URL, ip input: String) throws -> URL? {
        let input = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if input.isEmpty { return nil }
        let components = input.split(separator: ".", omittingEmptySubsequences: false)
        guard components.count == 4 else { throw AuthFailure.invalidLANIP }
        let octets = components.compactMap { part -> UInt8? in
            guard !part.isEmpty, part.count <= 3,
                  part.count == 1 || part.first != "0",
                  part.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return nil }
            return UInt8(part)
        }
        guard octets.count == 4 else { throw AuthFailure.invalidLANIP }
        let privateIP = octets[0] == 10 ||
            (octets[0] == 172 && (16...31).contains(Int(octets[1]))) ||
            (octets[0] == 192 && octets[1] == 168)
        guard privateIP, let host = origin.host, !host.isEmpty,
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
        try await selectOrigin(origin: origin, lanIP: lanIP, probe: probeVersion)
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

    private static func probeVersion(_ origin: URL) async throws {
        guard var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
            throw AuthFailure.invalidLANProbe
        }
        parts.path = "/api/v1/version"
        guard let url = parts.url else { throw AuthFailure.invalidLANProbe }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 3
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 3
        config.timeoutIntervalForResource = 4
        let session = URLSession(
            configuration: config,
            delegate: XDriveIOSLANProbeRejectRedirects(), delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        // URLSession's system TLS verifies this selected IP, including IP SAN.
        // The app does not import/override CA trust or forward credentials.
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw AuthFailure.invalidLANProbe
        }
        if (300..<400).contains(http.statusCode) { throw AuthFailure.redirectRefused }
        guard http.statusCode == 200, !data.isEmpty, data.count <= 16_384,
              let json = try? JSONDecoder().decode(XDriveIOSLANVersion.self, from: data),
              !json.version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              json.version.utf8.count <= 256 else {
            throw AuthFailure.invalidLANProbe
        }
    }
}

private struct XDriveIOSLANVersion: Decodable { let version: String }

private final class XDriveIOSLANProbeRejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
