import Foundation

@main enum XDrivePhotoCursorEpochPolicyChecks {
    static func main() {
        let policy = XDrivePhotoCursorEpochPolicy.self
        precondition(policy.canResume(hasPriorToken: true, tokenUnchanged: true,
                                      previousAuthorization: 3, currentAuthorization: 3))
        precondition(!policy.canResume(hasPriorToken: true, tokenUnchanged: false,
                                       previousAuthorization: 3, currentAuthorization: 3))
        precondition(policy.trustedWindow(requested: 390, hasPriorToken: true,
                                          tokenUnchanged: true,
                                          previousAuthorization: 3,
                                          currentAuthorization: 3) == 390)
        precondition(policy.trustedWindow(requested: 390, hasPriorToken: true,
                                          tokenUnchanged: false,
                                          previousAuthorization: 3,
                                          currentAuthorization: 3) == 0)
        precondition(policy.trustedWindow(requested: 390, hasPriorToken: false,
                                          tokenUnchanged: false,
                                          previousAuthorization: nil,
                                          currentAuthorization: 3) == 0)
        precondition(policy.trustedWindow(requested: 390, hasPriorToken: true,
                                          tokenUnchanged: true,
                                          previousAuthorization: 4,
                                          currentAuthorization: 3) == 0)
        precondition(policy.trustedWindow(requested: -1, hasPriorToken: true,
                                          tokenUnchanged: true,
                                          previousAuthorization: 3,
                                          currentAuthorization: 3) == 0)
        // A synthetic 100,000-slot sweep never resumes an old offset after
        // any deletion, insertion or authorization-generation change.
        for index in stride(from: 0, to: 100_000, by: 256) {
            precondition(policy.trustedWindow(requested: index,
                                              hasPriorToken: true,
                                              tokenUnchanged: false,
                                              previousAuthorization: 3,
                                              currentAuthorization: 3) == 0)
        }
        print("iOS persisted PhotoKit generation/window cursor policy: PASS")
    }
}
