import Foundation

@main struct XDriveIOSNativeMediaPageRetryPolicyChecks {
    static func main() {
        let policy = XDriveIOSNativeMediaPageRetryPolicy.self
        for status in [200, 301, 400, 401, 403, 404, 410, 422] {
            precondition(!policy.permitsRetainingPreviousPage(httpStatus: status))
        }
        for status in [408, 429, 500, 502, 503, 599] {
            precondition(policy.permitsRetainingPreviousPage(httpStatus: status))
        }
        precondition(!policy.permitsRetainingPreviousPage(httpStatus: 600))

        let transient: [URLError.Code] = [
            .notConnectedToInternet, .networkConnectionLost, .timedOut,
            .cannotConnectToHost, .cannotFindHost
        ]
        for code in transient {
            precondition(policy.permitsRetainingPreviousPage(urlError: code))
        }
        let denied: [URLError.Code] = [
            .serverCertificateUntrusted, .userAuthenticationRequired,
            .cancelled, .badURL
        ]
        for code in denied {
            precondition(!policy.permitsRetainingPreviousPage(urlError: code))
        }
        print("iOS native cloud Gallery cache retention: PASS")
    }
}
