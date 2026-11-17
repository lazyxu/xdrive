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
        // A failed/retired Owner must not allow protected native clients
        // to bypass the router and send old tokens directly over CFNetwork.
        func required(_ path: String, method: String = "GET",
                      bearer: Bool = false) -> Bool {
            var req = URLRequest(url: URL(string: "https://drive.example.com" + path)!)
            req.httpMethod = method
            if bearer { req.setValue("Bearer old-owner", forHTTPHeaderField: "Authorization") }
            return XDriveIOSAutoRouteSafety.needsVerifiedRoute(req)
        }
        precondition(required("/api/v1/nodes/root", bearer: true))
        precondition(required("/api/v1/clipboard/events", bearer: true))
        precondition(required("/api/v1/file-preview/17?ticket=opaque"))
        precondition(required("/api/v1/ios/photos/background-grants/proof"))
        precondition(required("/api/v1/auth/refresh", method: "POST"))
        precondition(required("/api/v1/auth/login", method: "GET"))
        precondition(required("/api/v1/auth/logout", method: "POST", bearer: true))
        precondition(!required("/api/v1/auth/login", method: "POST"))
        precondition(!required("/api/v1/auth/logout", method: "POST"))
        precondition(!required("/outside/api/v1/nodes/root"))
        // LAN reachability proof cannot outlive the Wi-Fi it was admitted on.
        // The initial NWPathMonitor callback preserves the LAN generation
        // only when the existing anonymous probe is still on that same path.
        func deliver(_ isLAN: Bool, _ proven: Bool, _ local: Bool,
                     _ admitted: UInt64, _ current: UInt64) -> Bool {
            XDriveIOSAutoRouteSafety.mayDeliverFromRoute(
                physicalIsLAN: isLAN, lanProofPresent: proven,
                localPath: local, admittedLANEpoch: admitted,
                currentLANEpoch: current)
        }
        precondition(deliver(true, true, true, 3, 3))
        precondition(!deliver(true, false, true, 3, 3),
                     "retired LAN proof cannot deliver late bytes")
        precondition(!deliver(true, true, false, 3, 3),
                     "LAN traffic cannot deliver on cellular")
        precondition(!deliver(true, true, true, 3, 4),
                     "old Wi-Fi A requests cannot deliver on Wi-Fi B")
        precondition(deliver(true, true, true, 4, 4),
                     "fresh verified Wi-Fi B requests can deliver")
        precondition(deliver(false, false, false, 3, 4),
                     "verified WAN is not invalidated by a LAN path change")
        print("iOS LAN/WAN safety: exact Owner, stale LAN denial, no TLS/cancel/write replay passed")
    }
}
