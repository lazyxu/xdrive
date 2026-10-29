import Foundation

@main
struct IOSBGApprovalPolicyChecks {
    static func main() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let p = XDriveIOSBGApprovalPolicy.self
        precondition(p.validInterval(60))
        precondition(p.validInterval(360))
        precondition(p.validInterval(1440))
        precondition(!p.validInterval(0))
        precondition(!p.validInterval(15))
        precondition(!p.validInterval(180))
        precondition(p.validLifetime(
            approvedAt: now,
            expiresAt: now.addingTimeInterval(14 * 24 * 3600), now: now
        ))
        precondition(!p.validLifetime(
            approvedAt: now,
            expiresAt: now, now: now
        ))
        precondition(!p.validLifetime(
            approvedAt: now,
            expiresAt: now.addingTimeInterval(16 * 24 * 3600), now: now
        ))
        precondition(!p.validLifetime(
            approvedAt: now.addingTimeInterval(3600),
            expiresAt: now.addingTimeInterval(2 * 3600), now: now
        ))
        print("iOS approved background grant interval and lifetime: PASS")
    }
}
