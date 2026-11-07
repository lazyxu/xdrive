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
        if case .ipCertificateInvalid = classify(URLError(.serverCertificateUntrusted)) {}
        else { preconditionFailure("IP TLS mismatch misclassified") }
        if case .ipCertificateInvalid = classify(URLError(.secureConnectionFailed)) {}
        else { preconditionFailure("IP TLS transport mismatch misclassified") }
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
            "IP SAN"), "real TLS rejection must mention IP identity")
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
