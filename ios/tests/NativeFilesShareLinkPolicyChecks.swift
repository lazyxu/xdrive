import Foundation

@main
struct NativeFilesShareLinkPolicyChecks {
    static func main() {
        let policy = XDriveIOSNativeFilesShareLinkPolicy.self
        let token = String(repeating: "A", count: 43)
        precondition(policy.validToken(token))
        precondition(!policy.validToken("short"))
        precondition(!policy.validToken(String(repeating: "/", count: 43)))
        precondition(!policy.validToken(String(repeating: "é", count: 43)))
        precondition(policy.validAccess("read_only", isDirectory: false))
        precondition(policy.validAccess("read_only", isDirectory: true))
        precondition(policy.validAccess("view_upload", isDirectory: true))
        precondition(!policy.validAccess("view_upload", isDirectory: false))
        precondition(!policy.validAccess("write", isDirectory: true))
        precondition(policy.allowedExpiryDays == Set([0, 1, 7, 30]))
        let now = Date(timeIntervalSince1970: 1_000)
        precondition(policy.expiry(days: 0, now: now) == nil)
        precondition(policy.expiry(days: 1, now: now) == now.addingTimeInterval(86_400))
        precondition(policy.expiry(days: 7, now: now) == now.addingTimeInterval(604_800))
        precondition(policy.expiry(days: 30, now: now) == now.addingTimeInterval(2_592_000))
        precondition(policy.expiry(days: -1, now: now) == nil)
        precondition(policy.expiry(days: 31, now: now) == nil)
        let expected = "https://nas.example:8443/#/s/\(token)"
        precondition(policy.url(origin: URL(string: "https://nas.example:8443")!, token: token)?.absoluteString == expected)
        precondition(policy.url(origin: URL(string: "https://192.168.1.7:8443/")!, token: token)?.absoluteString == "https://192.168.1.7:8443/#/s/\(token)")
        precondition(policy.url(origin: URL(string: "http://nas.example")!, token: token) == nil)
        precondition(policy.url(origin: URL(string: "https://nas.example/path")!, token: token) == nil)
        precondition(policy.url(origin: URL(string: "https://nas.example/?q=x")!, token: token) == nil)
        precondition(policy.url(origin: URL(string: "https://nas.example/#frag")!, token: token) == nil)
        precondition(policy.url(origin: URL(string: "https://person@nas.example")!, token: token) == nil)
        print("iOS native Files share link policy: PASS")
    }
}