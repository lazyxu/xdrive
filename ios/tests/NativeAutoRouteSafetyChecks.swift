import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@main
struct XDriveIOSAutoRouteSafetyChecks {
    static func main() {
        func request(_ method: String) -> URLRequest {
            var value = URLRequest(url: URL(string: "https://drive.example.com/api/v1/nodes/root")!)
            value.httpMethod = method
            return value
        }
        let networkFailures: [URLError.Code] = [
            .timedOut, .networkConnectionLost, .notConnectedToInternet,
            .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed
        ]
        for failure in networkFailures {
            for method in ["GET", "HEAD"] {
                precondition(XDriveIOSAutoRouteSafety.mayReplay(
                    request(method), after: URLError(failure), responseStarted: false))
                precondition(!XDriveIOSAutoRouteSafety.mayReplay(
                    request(method), after: URLError(failure), responseStarted: true),
                    "partial media or SSE response must not be replayed")
            }
            for method in ["POST", "PUT", "PATCH", "DELETE"] {
                precondition(!XDriveIOSAutoRouteSafety.mayReplay(
                    request(method), after: URLError(failure), responseStarted: false),
                    "unknown write/finalize ACK must never be replayed")
            }
        }
        let nonNetworkFailures: [URLError.Code] = [
            .cancelled, .secureConnectionFailed, .serverCertificateUntrusted,
            .serverCertificateHasUnknownRoot, .serverCertificateHasBadDate,
            .badServerResponse, .userAuthenticationRequired, .appTransportSecurityRequiresSecureConnection
        ]
        for failure in nonNetworkFailures {
            precondition(!XDriveIOSAutoRouteSafety.isNetworkFailure(URLError(failure)))
            precondition(!XDriveIOSAutoRouteSafety.mayReplay(
                request("GET"), after: URLError(failure), responseStarted: false))
        }

        func same(_ instance: String, _ owner: UInt64, _ user: String,
                  _ root: UInt64) -> Bool {
            XDriveIOSAutoRouteSafety.sameIdentity(
                lhsInstance: "installation-A", lhsOwner: 7, lhsUsername: "owner",
                lhsRoot: 42, rhsInstance: instance, rhsOwner: owner,
                rhsUsername: user, rhsRoot: root)
        }
        precondition(same("installation-A", 7, "owner", 42))
        precondition(!same("installation-B", 7, "owner", 42))
        precondition(!same("installation-A", 8, "owner", 42))
        precondition(!same("installation-A", 7, "other", 42))
        precondition(!same("installation-A", 7, "owner", 43))
        precondition(!XDriveIOSAutoRouteSafety.sameIdentity(
            lhsInstance: "", lhsOwner: 0, lhsUsername: "owner", lhsRoot: 0,
            rhsInstance: "", rhsOwner: 0, rhsUsername: "owner", rhsRoot: 0),
            "empty Owner credentials cannot become an authenticated route")
        // Both candidates must be verified; a previously used IP alone is
        // never permission to send credentials after a Wi-Fi/cellular handoff.
        let wan = URL(string: "https://drive.example.com:8443")!
        let lan = URL(string: "https://192.168.2.4:8443")!
        func selected(_ proven: Set<String>, wifi: Bool) -> URL? {
            XDriveIOSAutoRouteSafety.preferredOrigin(
                domain: wan, lan: lan, proven: proven, onLocalNetwork: wifi)
        }
        precondition(selected([lan.absoluteString], wifi: true) == lan)
        precondition(selected([lan.absoluteString], wifi: false) == nil)
        precondition(selected([wan.absoluteString], wifi: false) == wan)
        precondition(selected([wan.absoluteString], wifi: true) == wan)
        precondition(selected([wan.absoluteString, lan.absoluteString], wifi: true) == lan)
        precondition(selected([wan.absoluteString, lan.absoluteString], wifi: false) == wan)
        precondition(selected([], wifi: true) == nil)
        precondition(selected([], wifi: false) == nil)
        precondition(XDriveIOSAutoRouteSafety.preferredOrigin(
            domain: wan, lan: nil, proven: [wan.absoluteString],
            onLocalNetwork: true) == wan)
        print("iOS LAN/WAN safety: exact Owner, unproven-route denial, no TLS/cancel/write replay passed")
    }
}
