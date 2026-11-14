import Foundation

/// Pure decision shared by the real SwiftUI Files page and executable tests.
/// Never retain one Owner's directory in another Owner's navigation stack.
enum XDriveIOSNativeFilesNavigationPolicy {
    /// A hidden Files tab must not start a new Owner's home/search GET or
    /// restore its saved navigation stack. The next visible onAppear owns
    /// that work, after verifying the current Owner and scene.
    static func shouldStartOwnerRead(visible: Bool, active: Bool,
                                     hasOwner: Bool) -> Bool {
        visible && active && hasOwner
    }

    static func canResume(verified: Bool, loading: Bool, sameOwner: Bool,
                          sameFolder: Bool, sameQuery: Bool,
                          sameFilters: Bool, sameSort: Bool,
                          sameOrder: Bool) -> Bool {
        verified && !loading && sameOwner && sameFolder && sameQuery &&
            sameFilters && sameSort && sameOrder
    }
}
