import Foundation

/// Pure decision shared by the real SwiftUI Files page and executable tests.
/// Never retain one Owner's directory in another Owner's navigation stack.
enum XDriveIOSNativeFilesNavigationPolicy {
    /// SwiftUI can retain a NavigationLink's source row after a login or
    /// Owner change. Never create a heavy protected child for a stale row.
    /// The destination reader must still independently verify Server access.
    static func canEnterProtectedChild(
        sessionMatches: Bool, sourceOwnerMatches: Bool
    ) -> Bool {
        sessionMatches && sourceOwnerMatches
    }

    static func canResume(verified: Bool, loading: Bool, sameOwner: Bool,
                          sameFolder: Bool, sameQuery: Bool,
                          sameFilters: Bool, sameSort: Bool,
                          sameOrder: Bool) -> Bool {
        verified && !loading && sameOwner && sameFolder && sameQuery &&
            sameFilters && sameSort && sameOrder
    }
}
