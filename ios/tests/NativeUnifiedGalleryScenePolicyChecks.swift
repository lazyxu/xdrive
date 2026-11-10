import Foundation

@main
struct NativeUnifiedGalleryScenePolicyChecks {
    private static func reset(
        changed: Bool = false,
        local: Bool = true,
        epoch: Bool = true,
        current: Bool = true
    ) -> Bool {
        XDriveIOSUnifiedGalleryScenePolicy.requiresResetOnReturn(
            permissionChanged: changed,
            localAccessGranted: local,
            hasEpoch: epoch,
            epochCurrent: current
        )
    }

    static func main() {
        precondition(!reset(), "unchanged authorized PhotoKit must retain the Gallery wall")
        precondition(!reset(local: false, epoch: false, current: false),
                     "signed-out/no-PhotoKit wall may remain mounted")
        precondition(reset(changed: true), "PhotoKit permission revocation invalidates")
        precondition(reset(changed: true, local: false), "new permission grant invalidates")
        precondition(reset(epoch: true, current: false), "PhotoKit epoch change invalidates")
        precondition(reset(local: true, epoch: false),
                     "authorized PhotoKit without a captured epoch cannot be reused")
        precondition(!reset(local: false, epoch: true, current: true),
                     "a consistently unavailable local library must not flicker")
        precondition(!reset(local: false, epoch: true, current: false),
                     "an unchanged denied grant has no readable local images")
        for _ in 0..<8 {
            precondition(!reset(), "eight unchanged scene cycles must not rebuild pages")
        }
        print("native unified Gallery scene continuity: 8 policy cases + 8 repeats PASS")
    }
}
