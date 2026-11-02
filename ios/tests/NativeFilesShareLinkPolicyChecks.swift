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
        // PATCH must send an explicit null to remove expiry without rotating
        // the opaque link. Valid expiry continues using UTC ISO-8601.
        let serializer = JSONEncoder()
        serializer.dateEncodingStrategy = .iso8601
        let permanent = try! serializer.encode(
            XDriveIOSNativeFilesSharePolicyUpdateBody(
                access: "read_only", expires_at: nil
            )
        )
        let permanentJSON = try! JSONSerialization.jsonObject(
            with: permanent
        ) as! [String: Any]
        precondition(permanentJSON["expires_at"] is NSNull)
        precondition(permanentJSON["access"] as? String == "read_only")
        precondition(permanentJSON["token"] == nil)
        let temporary = try! serializer.encode(
            XDriveIOSNativeFilesSharePolicyUpdateBody(
                access: "view_upload", expires_at: now
            )
        )
        let temporaryJSON = try! JSONSerialization.jsonObject(
            with: temporary
        ) as! [String: Any]
        precondition(temporaryJSON["expires_at"] as? String == "1970-01-01T00:16:40Z")
        precondition(temporaryJSON["access"] as? String == "view_upload")
        precondition(temporaryJSON["token"] == nil)
        print("iOS native Files share link policy: PASS")
    }
}