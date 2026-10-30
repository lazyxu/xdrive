import Foundation

@main struct XDriveIOSBackgroundUploadRoutePolicyChecks {
    static func main() {
        let p = XDriveIOSBackgroundUploadRoutePolicy.self
        let id = "e800f564-1d5f-48f5-b1cf-e134242c64f8"
        let root = "/api/v1/ios/photos/background/uploads"
        precondition(p.translatedPath("/api/v1/uploads") == root)
        precondition(p.translatedPath("/api/v1/uploads/" + id) == root + "/" + id)
        precondition(p.translatedPath("/api/v1/uploads/" + id + "/chunks/0") ==
                     root + "/" + id + "/chunks/0")
        precondition(p.translatedPath("/api/v1/uploads/" + id + "/chunks/128") ==
                     root + "/" + id + "/chunks/128")
        precondition(p.translatedPath("/api/v1/uploads/" + id + "/finalize") ==
                     root + "/" + id + "/finalize")
        for path in [
            "/api/v1/nodes/1", "/api/v1/uploads/preflight", "/api/v1/uploads/resume-lookup",
            "/api/v1/uploads/" + id + "/chunks/-1",
            "/api/v1/uploads/" + id + "/chunks/01",
            "/api/v1/uploads/" + id + "/chunks/999999",
            "/api/v1/uploads/" + id + "/finalize/anything",
            "/api/v1/uploads/" + id + "/abort",
            "/api/v1/uploads/" + id + "//finalize",
            "/api/v1/uploads/" + id + "?owner=any",
            "/api/v1/uploads/../../../nodes/1"
        ] {
            precondition(p.translatedPath(path) == nil, "unexpected route: \(path)")
        }

        let naming = XDriveIOSBackgroundOriginalNamePolicy.self
        for name in [
            "IMG_0001-xios-0123456789abcdef01234567-abcdef123456.heic",
            "Movie-xios-0123456789abcdef01234567-abcdef123456.MOV",
            "Live-xios-0123456789abcdef01234567-abcdef123456.zip"
        ] { precondition(naming.valid(name), "valid original rejected: \(name)") }
        for name in [
            "IMG_0001.HEIC", "../IMG-xios-0123456789abcdef01234567-abcdef123456.mov",
            "IMG-xios-0123456789abcdef01234567-ABCDEF123456.mov",
            "IMG-xios-0123456789abcdef01234567-abcdef123456.bad/evil",
            "IMG-xios-0123456789abcdef01234567-abcdef123456.a.b",
            "IMG-xios-0123456789abcdef01234567-abcdef123456."
        ] { precondition(!naming.valid(name), "invalid admitted: \(name)") }
        print("iOS background Owner-root scoped upload routes and filenames: PASS")
    }
}
