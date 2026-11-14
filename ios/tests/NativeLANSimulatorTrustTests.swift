import Foundation
import XCTest

/// Runs inside an actual iPhone Simulator XCTest process. The fixture is a
/// CI-owned local TLS server, not a real NAS or a signed physical iPhone.
final class NativeLANSimulatorTrustTests: XCTestCase {
    private final class Capture: XDriveIOSServerTLSDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private var rejected: XDriveIOSLANTrustVerdict?
        private var proof: XDriveIOSLANTrustEvidence?

        var rejection: XDriveIOSLANTrustVerdict? {
            lock.lock()
            defer { lock.unlock() }
            return rejected
        }

        var evidence: XDriveIOSLANTrustEvidence? {
            lock.lock()
            defer { lock.unlock() }
            return proof
        }

        override func observedTrustRejection(_ verdict: XDriveIOSLANTrustVerdict) {
            lock.lock()
            rejected = verdict
            lock.unlock()
        }

        override func observedPairingEvidence(_ value: XDriveIOSLANTrustEvidence) {
            lock.lock()
            proof = value
            lock.unlock()
        }
    }

    private func probe(port: Int, rootDER: Data, wanted: XDriveIOSLANTrustVerdict,
                       reason: XDriveIOSLANTrustEvidence.Reason?) async throws {
        let ip = "192.168.2.4"
        let authority = try XCTUnwrap(XDriveIOSLANAuthority(ip: ip, port: port))
        let delegate = Capture(mode: .verifyingPairing(authority, rootDER))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 7
        configuration.timeoutIntervalForResource = 9
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }

        var request = URLRequest(url: try XCTUnwrap(URL(string: "https://\(ip):\(port)/api/v1/version")))
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 7

        do {
            let (data, response) = try await session.data(for: request)
            XCTAssertEqual(wanted, .trusted, "Simulator unexpectedly accepted a bad IP/CA")
            XCTAssertNil(delegate.rejection)
            XCTAssertNil(delegate.evidence)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            let version = try JSONSerialization.jsonObject(with: data) as? [String: String]
            XCTAssertEqual(version?["version"], "test")
        } catch {
            guard wanted != .trusted else {
                XCTFail("A valid pinned IP SAN chain failed in the iPhone Simulator: \(type(of: error))")
                return
            }
            XCTAssertEqual(delegate.rejection, wanted,
                           "A failed handshake without a pinned trust challenge must not be misclassified")
            let evidence = try XCTUnwrap(delegate.evidence)
            XCTAssertEqual(evidence.reason, reason)
            XCTAssertEqual(evidence.rootSHA256, XDriveIOSLANTrustEvidence.digest(rootDER))
            XCTAssertEqual(evidence.leafSHA256?.count, 64, "require peer leaf proof")
            XCTAssertNil(evidence.setupOSStatus, "a strict trust reject is not a policy-setup failure")
        }
    }

    /// Exercise the exact production stage-3 /version request, not merely a
    /// separately written data(for:) URLSession fixture. The installed phone
    /// hit -1202 at this boundary on c511f73ebac0.
    private func productStage3(port: Int, rootDER: Data,
                               expected: XDriveIOSLANTrustEvidence.Reason?) async throws {
        let ip = "192.168.2.4"
        let target = try XCTUnwrap(XDriveIOSLANAuthority(ip: ip, port: port))
        let url = try XCTUnwrap(URL(string: "https://\(ip):\(port)"))
        do {
            try await XDriveIOSNativeLANLoginRoute.probeVersion(
                url, mode: .verifyingPairing(target, rootDER), pairing: true
            )
            XCTAssertNil(expected, "Production stage-3 silently accepted a bad certificate")
        } catch let failure as XDriveIOSLANPairingFailure {
            guard let expected else {
                XCTFail("Production stage-3 rejected valid pinned TLS with \(failure.message)")
                return
            }
            guard case .ipCertificateEvidence(let evidence) = failure else {
                XCTFail("Production stage-3 returned wrong failure class: \(failure.message)")
                return
            }
            XCTAssertEqual(evidence.reason, expected)
            XCTAssertEqual(evidence.rootSHA256,
                           XDriveIOSLANTrustEvidence.digest(rootDER))
            XCTAssertEqual(evidence.leafSHA256?.count, 64)
            XCTAssertNil(evidence.setupOSStatus)
        } catch {
            XCTFail("Production stage-3 escaped strict trust classification: \(type(of: error))")
        }
    }

    func testProductStage3UsesBoundedDataTaskAndPinnedIPTrust() async throws {
        let rootPEM = try XCTUnwrap(Data(base64Encoded: NativeLANSimulatorConfig.trustedRootPEMBase64))
        let otherRootPEM = try XCTUnwrap(Data(base64Encoded: NativeLANSimulatorConfig.otherRootPEMBase64))
        let root = try XCTUnwrap(XDriveIOSLANPairing.rootDER(from: rootPEM))
        let other = try XCTUnwrap(XDriveIOSLANPairing.rootDER(from: otherRootPEM))
        try await productStage3(port: NativeLANSimulatorConfig.validPort,
                                rootDER: root, expected: nil)
        try await productStage3(port: NativeLANSimulatorConfig.wrongIPPort,
                                rootDER: root, expected: .ipIdentity)
        try await productStage3(port: NativeLANSimulatorConfig.validPort,
                                rootDER: other, expected: .chainOrValidity)
    }

    func testNoTrustChallengeAndPostAcceptedTrustErrorsRemainDistinct() {
        let absent = XDriveIOSNativeLANLoginRoute
            .pairingProbeFailure(URLError(.serverCertificateUntrusted)).message
        XCTAssertTrue(absent.contains("NO_TRUST_CHALLENGE"))
        let later = XDriveIOSLANPairingFailure
            .ipCertificatePostTrustFailure(-1202).message
        XCTAssertTrue(later.contains("POST_TRUST_SYSTEM_REJECTION"))
        XCTAssertFalse(later.contains("NO_TRUST_CHALLENGE"))
    }

    func testActualSimulatorURLSessionPrivateIPTrust() async throws {
        let rootPEM = try XCTUnwrap(Data(base64Encoded: NativeLANSimulatorConfig.trustedRootPEMBase64))
        let otherRootPEM = try XCTUnwrap(Data(base64Encoded: NativeLANSimulatorConfig.otherRootPEMBase64))
        let root = try XCTUnwrap(XDriveIOSLANPairing.rootDER(from: rootPEM))
        let wrongRoot = try XCTUnwrap(XDriveIOSLANPairing.rootDER(from: otherRootPEM))

        try await probe(port: NativeLANSimulatorConfig.validPort, rootDER: root,
                        wanted: .trusted, reason: nil)
        try await probe(port: NativeLANSimulatorConfig.wrongIPPort, rootDER: root,
                        wanted: .ipIdentityOrServerUsageMismatch, reason: .ipIdentity)
        try await probe(port: NativeLANSimulatorConfig.validPort, rootDER: wrongRoot,
                        wanted: .chainOrValidityMismatch, reason: .chainOrValidity)
    }
}
