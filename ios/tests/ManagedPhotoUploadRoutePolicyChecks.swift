import Foundation

@main struct ManagedPhotoUploadRoutePolicyChecks {
    static func main() {
        typealias P = XDriveIOSManagedPhotoUploadRoutePolicy
        let id = "a61b675e-8dae-48cd-8247-f54665885188"
        let root = "/api/v1/ios/photos/managed/uploads"
        precondition(P.translatedPath("/api/v1/uploads") == root)
        precondition(P.translatedPath("/api/v1/uploads/" + id) == root + "/" + id)
        precondition(P.translatedPath("/api/v1/uploads/" + id + "/finalize") ==
                     root + "/" + id + "/finalize")
        precondition(P.translatedPath("/api/v1/uploads/" + id + "/chunks/0") ==
                     root + "/" + id + "/chunks/0")
        precondition(P.translatedPath("/api/v1/uploads/" + id + "/chunks/255") ==
                     root + "/" + id + "/chunks/255")
        for rejected in [
            "/api/v1/nodes/7", "/api/v1/uploads/../nodes", "/api/v1/uploads/" + id + "/chunks/-1",
            "/api/v1/uploads/" + id + "/chunks/256",
            "/api/v1/uploads/" + id + "/finalize/again",
            "/api/v1/uploads/resume-lookup",
            "/api/v1/uploads/" + id + "/delete",
            "/api/v1/ios/photos/background/uploads",
            "/api/v1/uploads/" + id + "?token=wrong",
        ] {
            precondition(P.translatedPath(rejected) == nil, "admitted: " + rejected)
        }
        typealias BG = XDriveIOSManagedPhotoBackgroundUploadRoutePolicy
        let bgRoot = "/api/v1/ios/photos/background-managed/uploads"
        precondition(BG.translatedPath("/api/v1/uploads") == bgRoot)
        precondition(BG.translatedPath("/api/v1/uploads/" + id + "/finalize") ==
                     bgRoot + "/" + id + "/finalize")
        precondition(BG.translatedPath("/api/v1/uploads/" + id + "/chunks/1") ==
                     bgRoot + "/" + id + "/chunks/1")
        precondition(BG.translatedPath("/api/v1/nodes/1") == nil)
        precondition(BG.translatedPath("/api/v1/uploads/resume-lookup") == nil)
        print("PASS: exact foreground and background managed UploadSession aliases")
    }
}
