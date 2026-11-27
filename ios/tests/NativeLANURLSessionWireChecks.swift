import Foundation
import Security

/// Run only against a test-runner-owned loopback alias and ephemeral TLS server.
/// Never sends authentication credentials or probes a real xDrive installation.
@main
struct NativeLANURLSessionWireChecks {
    private final class CapturingTrustDelegate: XDriveIOSServerTLSDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private var lastVerdict: XDriveIOSLANTrustVerdict?
        private var lastEvidence: XDriveIOSLANTrustEvidence?

        var evidence: XDriveIOSLANTrustEvidence? {
            lock.lock()
            defer { lock.unlock() }
            return lastEvidence
        }

        var rejection: XDriveIOSLANTrustVerdict? {
            lock.lock()
            defer { lock.unlock() }
            return lastVerdict
        }

        override func observedTrustRejection(_ verdict: XDriveIOSLANTrustVerdict) {
            lock.lock()
            lastVerdict = verdict
            lock.unlock()
        }

        override func observedPairingEvidence(_ value: XDriveIOSLANTrustEvidence) {
            lock.lock()
            lastEvidence = value
            lock.unlock()
        }
    }

    static func main() async throws {
        guard CommandLine.arguments.count == 5 else {
            fatalError("expected: <port> <trusted|identity|chain> <root PEM> <label>")
        }
        let rootPEM = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))
        guard let port = Int(CommandLine.arguments[1]),
              let authority = XDriveIOSLANAuthority(ip: "192.168.2.4", port: port),
              ["trusted", "identity", "chain"].contains(CommandLine.arguments[2]),
              let root = XDriveIOSLANPairing.rootDER(from: rootPEM) else {
            fatalError("invalid test port, category or root fixture")
        }
        let expected = CommandLine.arguments[2]
        let label = CommandLine.arguments[4]
        let delegate = CapturingTrustDelegate(mode: .verifyingPairing(authority, root))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 6
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: "https://192.168.2.4:\(port)/api/v1/version")!)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 5
        do {
            let (data, response) = try await session.data(for: request)
            guard expected == "trusted", delegate.rejection == nil, delegate.evidence == nil,
                  let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: String],
                  json["version"] == "test" else {
                fatalError("\(label): URLSession accepted unexpected TLS/response")
            }
            print("\(label): Apple URLSession accepted pinned CA + literal IP SAN")
        } catch {
            guard expected != "trusted" else {
                throw NSError(domain: "xDriveAppleWireCheck", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "\(label): valid peer rejected by URLSession"])
            }
            let verdict = delegate.rejection
            let proof = delegate.evidence
            guard (expected == "identity" && verdict == .ipIdentityOrServerUsageMismatch &&
                   proof?.reason == .ipIdentity) ||
                  (expected == "chain" && verdict == .chainOrValidityMismatch &&
                   proof?.reason == .chainOrValidity) else {
                throw NSError(domain: "xDriveAppleWireCheck", code: 2,
                    userInfo: [NSLocalizedDescriptionKey:
                        "\(label): expected \(expected), recorded \(String(describing: verdict))"])
            }
            guard proof?.rootSHA256 == XDriveIOSLANTrustEvidence.digest(root),
                  proof?.leafSHA256?.count == 64 else {
                fatalError("\(label): missing bounded SHA-256 evidence from real serverTrust")
            }
            print("\(label): Apple URLSession rejected expected category \(expected)")
        }
    }
}
