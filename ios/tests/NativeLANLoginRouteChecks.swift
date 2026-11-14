import Foundation

@main struct XDriveIOSNativeLANLoginRouteChecks {
    static func main() async throws {
        let domain = try ServerAddress.parse("https://drive.example.com:8443")
        let local = try ServerAddress.parse("https://192.168.2.4:8443")
        var probes = 0
        let selected = try await XDriveIOSNativeLANLoginRoute.selectOrigin(
            origin: domain, lanIP: "192.168.2.4", probe: { address in
                probes += 1
                precondition(address == local, "must preserve the original HTTPS port")
            })
        precondition(selected == local && probes == 1)
        let noLAN = try await XDriveIOSNativeLANLoginRoute.selectOrigin(
            origin: domain, lanIP: "", probe: { _ in fatalError("unexpected probe") })
        precondition(noLAN == domain, "blank LAN must preserve configured origin")

        for code in [URLError.cannotConnectToHost, .timedOut, .networkConnectionLost,
                     .notConnectedToInternet, .cannotFindHost] {
            let result = try await XDriveIOSNativeLANLoginRoute.selectOrigin(
                origin: domain, lanIP: "10.0.1.20",
                probe: { _ in throw URLError(code) })
            precondition(result == domain, "network-only DNS fallback")
        }
        for code in [URLError.secureConnectionFailed, .serverCertificateUntrusted,
                     .serverCertificateHasBadDate, .cancelled] {
            do {
                _ = try await XDriveIOSNativeLANLoginRoute.selectOrigin(
                    origin: domain, lanIP: "192.168.2.4",
                    probe: { _ in throw URLError(code) })
                fatalError("unsafe TLS/cancellation fallback")
            } catch let failure as URLError {
                precondition(failure.code == code)
            }
        }
        for reason in [AuthFailure.redirectRefused, .invalidLANProbe] {
            do {
                _ = try await XDriveIOSNativeLANLoginRoute.selectOrigin(
                    origin: domain, lanIP: "192.168.2.4",
                    probe: { _ in throw reason })
                fatalError("unsafe redirect/malformed response fallback")
            } catch let failure as AuthFailure {
                precondition(String(describing: failure) == String(describing: reason))
            }
        }
        for value in ["127.0.0.1", "8.8.8.8", "172.32.1.1", "192.167.1.1",
                      "192.168.01.2", "192.168.2.999", "192.168.2.4:8443",
                      "https://192.168.2.4", "192.168.2.4/a", "0.0.0.0",
                      "100.64.1.1", "192.168.2.4\n"] {
            do {
                _ = try XDriveIOSNativeLANLoginRoute.candidate(origin: domain, ip: value)
                fatalError("invalid LAN candidate accepted: \(value)")
            } catch AuthFailure.invalidLANIP { }
        }
        // Pairing must not flatten a valid TLS session followed by a
        // network/HTTP failure into the misleading "invalidRoot" category.
        let classify = XDriveIOSNativeLANLoginRoute.pairingProbeFailure
        if case .ipCertificateWithoutChallenge(let code) = classify(URLError(.serverCertificateUntrusted)) {
            precondition(code == URLError.serverCertificateUntrusted.rawValue)
        } else { preconditionFailure("unobserved TLS challenge must not be diagnosed as invalid CA/SAN") }
        if case .ipTLSHandshakeFailed(let code) = classify(URLError(.secureConnectionFailed)) {
            precondition(code == URLError.secureConnectionFailed.rawValue)
        } else { preconditionFailure("TLS handshake failure falsely blamed on IP SAN") }
        precondition(XDriveIOSLANPairingFailure.ipTLSHandshakeFailed(-1200).message.contains(
            "尚不能确定"), "a handshake failure must never claim an invalid root CA")
        precondition(XDriveIOSLANPairingFailure.ipCertificateIdentityInvalid.message.contains(
            "IP"), "confirmed IP identity failure must be actionable")
        precondition(XDriveIOSLANPairingFailure.ipCertificateChainInvalid.message.contains(
            "根 CA"), "confirmed pinned CA/chain failure must be actionable")
        if case .ipConnectionTimedOut = classify(URLError(.timedOut)) {}
        else { preconditionFailure("IP timeout wrongly blamed on CA") }
        if case .ipConnectionUnavailable(let code) = classify(URLError(.cannotConnectToHost)) {
            precondition(code == URLError.cannotConnectToHost.rawValue)
        } else { preconditionFailure("IP connection refused was misclassified") }
        if case .ipVersionRedirect = classify(AuthFailure.redirectRefused) {}
        else { preconditionFailure("IP HTTP redirect was misclassified") }
        if case .ipVersionInvalid = classify(AuthFailure.invalidLANProbe) {}
        else { preconditionFailure("IP version payload was misclassified") }
        if case .ipVersionStatus(let status) = classify(
            XDriveIOSLANPairingFailure.ipVersionStatus(503)) {
            precondition(status == 503)
        } else { preconditionFailure("IP HTTP status was misclassified") }
        precondition(!XDriveIOSLANPairingFailure.ipVersionInvalid.message.contains(
            "域名提供的证书无法验证"), "unknown JSON must not blame a valid certificate")
        precondition(XDriveIOSLANPairingFailure.ipCertificateInvalid.message.contains(
            "指定 CA"), "generic certificate denial must describe the configured trust check")
        precondition(!XDriveIOSLANPairingFailure.ipCertificateInvalid.message.contains(
            "IP SAN"), "generic certificate denial must not invent a confirmed SAN mismatch")
        precondition(XDriveIOSLANPairingFailure.ipCertificateWithoutChallenge(-1202).message.contains(
            "NO_TRUST_CHALLENGE"), "missing callback must have an independent stable code")
        let rootHash = String(repeating: "a", count: 64)
        let leafHash = String(repeating: "b", count: 64)
        for (reason, code) in [
            (XDriveIOSLANTrustEvidence.Reason.challengeIdentity, "CHALLENGE_AUTHORITY"),
            (.trustObjectMissing, "SERVER_TRUST_MISSING"),
            (.retryChallenge, "REPEATED_CHALLENGE"),
            (.trustSetup, "TRUST_SETUP"),
            (.ipIdentity, "IP_IDENTITY"),
            (.chainOrValidity, "CHAIN_OR_VALIDITY")
        ] {
            let proof = XDriveIOSLANTrustEvidence(reason: reason, rootSHA256: rootHash,
                leafSHA256: leafHash, setupOSStatus: -50)
            let message = XDriveIOSLANPairingFailure.ipCertificateEvidence(proof).message
            precondition(message.contains(code), "missing fixed TLS reason code")
            precondition(message.contains(rootHash) && message.contains(leafHash),
                         "missing public-only fingerprints")
            precondition(message.contains("-50"), "missing bounded Security status")
            for secret in ["Bearer ", "Authorization:", "Cookie:", "password=", "privateKey"] {
                precondition(!message.contains(secret), "diagnostics may never serialize secrets")
            }
        }
        precondition(XDriveIOSLANPairingFailure.ipCertificateIdentityInvalid.message.contains(
            "SAN"), "confirmed IP identity rejection must mention SAN")
        precondition(XDriveIOSLANPairingFailure.ipVersionStatus(502).message.contains(
            "HTTP 502"), "HTTP diagnostic must carry bounded status only")
        let directIP = try ServerAddress.parse("https://192.168.2.4:8443")
        do {
            _ = try XDriveIOSNativeLANLoginRoute.candidate(origin: directIP, ip: "10.0.0.4")
            fatalError("direct-IP server must not also select a second IP")
        } catch AuthFailure.invalidLANIP { }
        let direct = try await XDriveIOSNativeLANLoginRoute.selectOrigin(
            origin: directIP, lanIP: "", probe: { _ in fatalError("no probe") })
        precondition(direct == directIP)
        print("iOS LAN route: pre-login choice, network fallback, TLS refusal and fixed origin passed")
    }
}
