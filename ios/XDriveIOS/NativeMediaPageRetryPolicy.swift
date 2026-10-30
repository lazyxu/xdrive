import Foundation

/// Keep only already-verified cloud photo metadata across transient failures.
/// A definitive access denial, deletion, malformed page or TLS trust failure
/// must not leave a previous Owner/album page on screen.
enum XDriveIOSNativeMediaPageRetryPolicy {
    static func permitsRetainingPreviousPage(httpStatus: Int) -> Bool {
        httpStatus == 408 || httpStatus == 429 || (500...599).contains(httpStatus)
    }

    static func permitsRetainingPreviousPage(urlError: URLError.Code) -> Bool {
        switch urlError {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut,
             .cannotConnectToHost, .cannotFindHost:
            return true
        default:
            return false
        }
    }
}
