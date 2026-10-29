import Foundation

@main struct IOSPhotoBackgroundGrantPolicyChecks {
    static func main() {
        let raw = Data((0..<32).map { UInt8($0) }).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        precondition(raw.count == 43)
        precondition(XDriveIOSPhotoBackgroundGrantPolicy.validOpaqueSecret(raw))
        precondition(!XDriveIOSPhotoBackgroundGrantPolicy.validOpaqueSecret(""))
        precondition(!XDriveIOSPhotoBackgroundGrantPolicy.validOpaqueSecret(raw + "="))
        precondition(!XDriveIOSPhotoBackgroundGrantPolicy.validOpaqueSecret("ios_" + raw))
        precondition(!XDriveIOSPhotoBackgroundGrantPolicy.validOpaqueSecret(
            String(repeating: ".", count: 43)
        ))
        let now = Date(timeIntervalSince1970: 1000)
        precondition(XDriveIOSPhotoBackgroundGrantPolicy.validExpiration(
            now.addingTimeInterval(14 * 86400), now: now
        ))
        precondition(!XDriveIOSPhotoBackgroundGrantPolicy.validExpiration(
            now, now: now
        ))
        precondition(!XDriveIOSPhotoBackgroundGrantPolicy.validExpiration(
            now.addingTimeInterval(16 * 86400), now: now
        ))
        print("iOS native background grant token/expiry contract: PASS")
    }
}
