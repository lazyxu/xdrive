import Foundation

@main
struct XDriveIOSNativeFilesNavigationChecks {
    static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        if !condition() {
            fputs("native Files navigation failed: \(name)\n", stderr)
            exit(1)
        }
    }

    static func allowed(verified: Bool = true, loading: Bool = false,
                        owner: Bool = true, folder: Bool = true,
                        query: Bool = true, filters: Bool = true,
                        sort: Bool = true, order: Bool = true) -> Bool {
        XDriveIOSNativeFilesNavigationPolicy.canResume(
            verified: verified, loading: loading, sameOwner: owner,
            sameFolder: folder, sameQuery: query, sameFilters: filters,
            sameSort: sort, sameOrder: order
        )
    }

    static func main() {
        require(allowed(), "return from child preserves previously verified parent")
        require(!allowed(verified: false), "failed/never-verified read cannot resume")
        require(!allowed(loading: true), "in-flight unconfirmed read cannot resume")
        require(!allowed(owner: false), "logout, account or Server change must invalidate")
        require(!allowed(folder: false), "different folder cannot reuse old rows")
        require(!allowed(query: false), "new full-library query cannot reuse old rows")
        require(!allowed(filters: false), "different tag/source/date/kind scope invalidates")
        require(!allowed(sort: false), "changed ordering invalidates")
        require(!allowed(order: false), "changed ascending/descending invalidates")
        require(XDriveIOSNativeFilesNavigationPolicy.canEnterProtectedChild(
            sessionMatches: true, sourceOwnerMatches: true
        ), "current session and captured Owner can enter protected child")
        require(!XDriveIOSNativeFilesNavigationPolicy.canEnterProtectedChild(
            sessionMatches: false, sourceOwnerMatches: true
        ), "session expiry must keep protected child unmounted")
        require(!XDriveIOSNativeFilesNavigationPolicy.canEnterProtectedChild(
            sessionMatches: true, sourceOwnerMatches: false
        ), "stale Owner row cannot enter after account switch")
        require(!XDriveIOSNativeFilesNavigationPolicy.canEnterProtectedChild(
            sessionMatches: false, sourceOwnerMatches: false
        ), "signed-out stale route never creates a heavy child")
        print("native Files navigation resume and child admission passed")
    }
}
