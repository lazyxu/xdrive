import Foundation

/// Pure decision shared by the real SwiftUI Files page and executable tests.
/// Never retain one Owner's directory in another Owner's navigation stack.
enum XDriveIOSNativeFilesNavigationPolicy {
    static func canResume(verified: Bool, loading: Bool, sameOwner: Bool,
                          sameFolder: Bool, sameQuery: Bool,
                          sameFilters: Bool, sameSort: Bool,
                          sameOrder: Bool) -> Bool {
        verified && !loading && sameOwner && sameFolder && sameQuery &&
            sameFilters && sameSort && sameOrder
    }
}
