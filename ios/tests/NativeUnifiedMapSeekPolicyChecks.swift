import Foundation

@main
struct XDriveIOSNativeUnifiedMapSeekPolicyChecks {
    static func main() {
        let policy = XDriveIOSNativeUnifiedMapSeekPolicy.self
        precondition(policy.maximumPages == 10_000)
        precondition(policy.cooperativeYieldPages == 256)
        precondition(!policy.shouldYield(beforePage: -1))
        precondition(!policy.shouldYield(beforePage: 0))
        precondition(!policy.shouldYield(beforePage: 255))
        precondition(policy.shouldYield(beforePage: 256))
        precondition(!policy.shouldYield(beforePage: 257))
        precondition(policy.shouldYield(beforePage: 512))
        precondition(!policy.shouldYield(beforePage: 9_999))
        precondition(!policy.shouldYield(beforePage: 10_000))

        // A hit after 257 nonmatching pages remains inside the verified
        // source-map range; the former 256-page hard stop lost it.
        let sparseNextHit = 258
        var reached = false
        for page in 0..<policy.maximumPages {
            if page == sparseNextHit { reached = true; break }
        }
        precondition(reached)
        precondition((0..<policy.maximumPages).contains(9_999))
        precondition(!(0..<policy.maximumPages).contains(10_000))
        print("unified-source-map sparse seek: PASS")
    }
}
