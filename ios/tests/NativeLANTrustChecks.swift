import Foundation
import Network
import Security

@main
enum NativeLANTrustChecks {
    static func main() throws {
        let fixtures = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        checkBootstrapFailures()
        let ip = XDriveIOSLANAuthority(ip: "192.168.2.4", port: 8443)!
        let otherIP = XDriveIOSLANAuthority(ip: "192.168.2.5", port: 8443)!
        precondition(ip != XDriveIOSLANAuthority(ip: "192.168.2.4", port: 443))
        precondition(XDriveIOSLANAuthority(ip: "127.0.0.1", port: 8443) == nil)
        precondition(XDriveIOSLANAuthority(ip: "192.168.002.4", port: 8443) == nil)
        precondition(XDriveIOSLANAuthority(ip: "192.168.2.4", port: 0) == nil)
        precondition(XDriveIOSLANPairing.publicDomain(URL(string: "https://drive.example.com:8443")!) ==
                     "https://drive.example.com:8443")
        for url in ["http://drive.example.com", "https://192.168.2.4", "https://u@drive.example.com",
                    "https://drive.example.com/path", "https://drive.example.com/?target=192.168.2.4"] {
            precondition(XDriveIOSLANPairing.publicDomain(URL(string: url)!) == nil, url)
        }

        let pem = try Data(contentsOf: fixtures.appendingPathComponent("ca.pem"))
        try checkBootstrapFraming(pem)
        let root = XDriveIOSLANPairing.rootDER(from: pem)!
        let otherRoot = XDriveIOSLANPairing.rootDER(from: try Data(contentsOf: fixtures.appendingPathComponent("other-ca.pem")))!
        precondition(XDriveIOSLANPairing.rootDER(from: pem + pem) == nil, "reject concatenated PEM")
        precondition(XDriveIOSLANPairing.rootDER(from: Data(repeating: 65, count: 8193)) == nil)
        let publicRoot = SecCertificateCreateWithData(nil, root as CFData)!

        func trust(_ name: String) throws -> SecTrust {
            let der = try Data(contentsOf: fixtures.appendingPathComponent(name + ".der"))
            let leaf = SecCertificateCreateWithData(nil, der as CFData)!
            var result: SecTrust?
            precondition(SecTrustCreateWithCertificates([leaf, publicRoot] as CFArray,
                                                         SecPolicyCreateBasicX509(), &result) == errSecSuccess)
            return result!
        }

        let valid = try trust("ip")
        // Build throwable SecTrust fixtures before any non-throwing precondition autoclosure.
        // Each trust is fresh so negative diagnostics cannot reuse a mutated evaluation.
        let matchedPolicyTrust = try trust("ip")
        let changedIPTrust = try trust("ip")
        let changedCATrust = try trust("ip")
        let dnsSANTrust = try trust("dns")
        precondition(XDriveIOSServerTLSDelegate.verify(valid, target: ip, rootDER: root), "correct CA and IP SAN")
        let evidenceRoot = XDriveIOSLANTrustEvidence.digest(root)
        precondition(evidenceRoot == XDriveIOSLANPairing(domain: "https://drive.example.com:8443",
            rootDER: root).fingerprint, "public root evidence must use canonical SHA-256")
        let originalLeaf = try Data(contentsOf: fixtures.appendingPathComponent("ip.der"))
        precondition(XDriveIOSLANTrustEvidence.peerLeafDigest(valid) ==
                     XDriveIOSLANTrustEvidence.digest(originalLeaf),
                     "evidence must hash the observed leaf, not the pinned root or intermediate")
        let noTrust = XDriveIOSLANTrustEvidence(reason: .trustObjectMissing,
            rootSHA256: evidenceRoot, leafSHA256: nil, setupOSStatus: nil)
        precondition(noTrust.safeSummary.contains("SERVER_TRUST_MISSING") &&
                     !noTrust.safeSummary.contains("对端叶证书") &&
                     noTrust.safeSummary.contains(evidenceRoot),
                     "missing-trust evidence may only show known public material")
        let detailedValid = XDriveIOSServerTLSDelegate.inspectDetailed(
            try trust("ip"), target: ip, rootDER: root)
        precondition(detailedValid.verdict == .trusted && detailedValid.setupOSStatus == nil,
                     "detailed inspection must keep the original strict positive check")
        precondition(XDriveIOSServerTLSDelegate.inspect(matchedPolicyTrust,
            target: ip, rootDER: root) == .trusted, "strict CA + literal IP SAN succeeds")
        precondition(XDriveIOSServerTLSDelegate.inspect(changedIPTrust,
            target: otherIP, rootDER: root) == .ipIdentityOrServerUsageMismatch,
            "basic X.509 chain passes but strict IP identity fails")
        precondition(XDriveIOSServerTLSDelegate.inspect(changedCATrust,
            target: ip, rootDER: otherRoot) == .chainOrValidityMismatch,
            "wrong pinned CA cannot be reported as a mere IP SAN mismatch")
        precondition(XDriveIOSServerTLSDelegate.inspect(dnsSANTrust,
            target: ip, rootDER: root) == .ipIdentityOrServerUsageMismatch,
            "DNS SAN must not authenticate a private-IP literal")
        // Real Caddy 'tls internal' chains include an intermediate CA.
        // A passed SecTrust evaluation under the PINNED root is sufficient,
        // even if an iOS release omits the externally added anchor from its
        // returned diagnostic chain representation.
        let intermediate = SecCertificateCreateWithData(nil,
            try Data(contentsOf: fixtures.appendingPathComponent("intermediate.der")) as CFData)!
        let child = SecCertificateCreateWithData(nil,
            try Data(contentsOf: fixtures.appendingPathComponent("ip-intermediate.der")) as CFData)!
        var caddyTrust: SecTrust?
        precondition(SecTrustCreateWithCertificates([child, intermediate, publicRoot] as CFArray,
            SecPolicyCreateBasicX509(), &caddyTrust) == errSecSuccess)
        precondition(XDriveIOSServerTLSDelegate.verify(caddyTrust!, target: ip, rootDER: root),
            "real Caddy root -> intermediate -> matching IP-SAN leaf")
        // A normal TLS server presents its leaf and intermediate; the root
        // is NOT generally sent in the peer chain. Only the downloaded,
        // explicitly anchored Caddy root may finish verification.
        var withoutTransmittedRoot: SecTrust?
        precondition(SecTrustCreateWithCertificates([child, intermediate] as CFArray,
            SecPolicyCreateBasicX509(), &withoutTransmittedRoot) == errSecSuccess)
        precondition(XDriveIOSServerTLSDelegate.verify(withoutTransmittedRoot!,
            target: ip, rootDER: root),
            "Caddy leaf + intermediate must verify against separately pinned root")
        var wrongCaddyRoot: SecTrust?
        precondition(SecTrustCreateWithCertificates([child, intermediate, publicRoot] as CFArray,
            SecPolicyCreateBasicX509(), &wrongCaddyRoot) == errSecSuccess)
        precondition(!XDriveIOSServerTLSDelegate.verify(wrongCaddyRoot!,
            target: ip, rootDER: otherRoot), "Caddy intermediate cannot bypass wrong pinned root")
        var wrongCaddyIP: SecTrust?
        precondition(SecTrustCreateWithCertificates([child, intermediate, publicRoot] as CFArray,
            SecPolicyCreateBasicX509(), &wrongCaddyIP) == errSecSuccess)
        precondition(!XDriveIOSServerTLSDelegate.verify(wrongCaddyIP!,
            target: otherIP, rootDER: root), "Caddy intermediate cannot bypass wrong IP SAN")

        let wrongIP = try trust("ip")
        precondition(!XDriveIOSServerTLSDelegate.verify(wrongIP, target: otherIP, rootDER: root), "reject wrong IP")
        let dnsOnly = try trust("dns")
        precondition(!XDriveIOSServerTLSDelegate.verify(dnsOnly, target: ip, rootDER: root), "reject DNS SAN as IP")
        let wrongRoot = try trust("ip")
        precondition(!XDriveIOSServerTLSDelegate.verify(wrongRoot, target: ip, rootDER: otherRoot), "reject wrong CA")
        let expired = try trust("ip")
        precondition(SecTrustSetVerifyDate(expired, Date(timeIntervalSinceNow: 14 * 86_400) as CFDate) == errSecSuccess)
        precondition(!XDriveIOSServerTLSDelegate.verify(expired, target: ip, rootDER: root), "reject expired leaf")
        let expiredDiagnostic = try trust("ip")
        precondition(SecTrustSetVerifyDate(expiredDiagnostic,
            Date(timeIntervalSinceNow: 14 * 86_400) as CFDate) == errSecSuccess)
        precondition(XDriveIOSServerTLSDelegate.inspect(expiredDiagnostic,
            target: ip, rootDER: root) == .chainOrValidityMismatch,
            "expired leaf must not be described as an IP SAN mismatch")
        let leafPEM = try Data(contentsOf: fixtures.appendingPathComponent("ip.pem"))
        precondition(XDriveIOSLANPairing.rootDER(from: leafPEM) == nil, "reject leaf as the root")
        print("Native LAN certificate policy checks passed")
    }

    private static func checkBootstrapFailures() {
        let classify = XDriveIOSLANCertificateBootstrap.transportFailure
        if case .localNetworkDenied = classify(.posix(.ENETDOWN), true) {} else {
            preconditionFailure("permission denial must not become a certificate error")
        }
        if case .localNetworkDenied = classify(.dns(-65570), false) {} else {
            preconditionFailure("policy denial must remain actionable")
        }
        if case .domainCertificateInvalid(let status) = classify(.tls(errSSLBadCert), false) {
            precondition(status == errSSLBadCert)
        } else { preconditionFailure("TLS failure was flattened") }
        if case .connectionUnavailable(let code) = classify(.posix(.ECONNREFUSED), false) {
            precondition(code == POSIXErrorCode.ECONNREFUSED.rawValue)
        } else { preconditionFailure("connection refusal was flattened") }
        if case .connectionTimedOut = classify(.posix(.ETIMEDOUT), false) {} else {
            preconditionFailure("timeout was flattened")
        }
        if case .connectionTimedOut = classify(nil, false) {} else {
            preconditionFailure("deadline without a transport error is a timeout")
        }
    }

    private static func checkBootstrapFraming(_ pem: Data) throws {
        let header = "HTTP/1.0 200 OK\r\nContent-Type: application/x-pem-file\r\nContent-Length: \(pem.count)\r\n"
        let partial = try XDriveIOSLANCertificateBootstrap.certificate(in: Data(header.utf8))
        precondition(partial == nil)
        let response = Data((header + "\r\n").utf8) + pem
        let incomplete = try XDriveIOSLANCertificateBootstrap.certificate(in: response.dropLast())
        precondition(incomplete == nil)
        let complete = try XDriveIOSLANCertificateBootstrap.certificate(in: response)
        precondition(complete == pem)
        for invalid in [header.replacingOccurrences(of: "200 OK", with: "302 Found"),
                        header + "Content-Length: \(pem.count)\r\n",
                        header + "Transfer-Encoding: chunked\r\n",
                        header.replacingOccurrences(of: "application/x-pem-file", with: "text/html"),
                        header.replacingOccurrences(of: "\(pem.count)", with: "99999")] {
            do {
                _ = try XDriveIOSLANCertificateBootstrap.certificate(in: Data((invalid + "\r\n").utf8) + pem)
                preconditionFailure("accepted invalid bootstrap response")
            } catch XDriveIOSLANPairingFailure.rootUnavailable { continue }
        }
    }
}
