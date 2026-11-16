import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Pure security policy used by every native iOS LAN/WAN transport.
/// This file intentionally has no keychain, SwiftUI, Network or URLSession
/// delegate dependencies so it can be tested in Linux and macOS CI.
enum XDriveIOSAutoRouteSafety {
    static func sameIdentity(
        lhsInstance: String, lhsOwner: UInt64, lhsUsername: String, lhsRoot: UInt64,
        rhsInstance: String, rhsOwner: UInt64, rhsUsername: String, rhsRoot: UInt64
    ) -> Bool {
        !lhsInstance.isEmpty && lhsOwner > 0 && lhsRoot > 0 &&
        lhsInstance == rhsInstance && lhsOwner == rhsOwner &&
        lhsUsername == rhsUsername && lhsRoot == rhsRoot
    }

    static func isNetworkFailure(_ error: Error) -> Bool {
        guard let url = error as? URLError else { return false }
        switch url.code {
        case .timedOut, .networkConnectionLost, .notConnectedToInternet,
             .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
            return true
        default:
            return false
        }
    }

    /// One untouched GET/HEAD may be replayed, *only* after an independent
    /// alternate-server Owner proof. No POST/PUT/DELETE, uncertain upload ACK,
    /// partially received stream, 401/403, TLS or cancellation is replayed.
    static func mayReplay(_ request: URLRequest, after error: Error,
                          responseStarted: Bool) -> Bool {
        !responseStarted &&
        ["GET", "HEAD"].contains((request.httpMethod ?? "GET").uppercased()) &&
        isNetworkFailure(error)
    }
}
