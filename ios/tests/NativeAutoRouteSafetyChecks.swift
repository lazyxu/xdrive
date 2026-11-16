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
        print("iOS LAN/WAN safety: exact Owner, no cross-Owner/TLS/cancel/write replay passed")
    }
}
