import Foundation

@main
struct XDriveIOSNativeFilesThumbnailPolicyChecks {
    private static func assertThat(_ condition: @autoclosure () -> Bool, _ name: String) {
        if !condition() {
            fputs("native Files thumbnail: \(name)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesThumbnailPolicy
        let image = XDriveIOSNativeFilesNode(
            id: 11, parent_id: 2, name: "sample.HEIC", type: "file",
            size: 8_000_000, revision: 3
        )
        let video = XDriveIOSNativeFilesNode(
            id: 12, parent_id: 2, name: "clip.MOV", type: "file",
            size: 80_000_000, revision: 1
        )
        let pdf = XDriveIOSNativeFilesNode(
            id: 13, parent_id: 2, name: "report.pdf", type: "file",
            size: 500_000, revision: 1
        )
        let folder = XDriveIOSNativeFilesNode(
            id: 14, parent_id: 2, name: "photos.jpg", type: "dir",
            size: 0, revision: 2
        )
        let root = XDriveIOSNativeFilesNode(
            id: 1, parent_id: nil, name: "", type: "dir",
            size: 0, revision: 1
        )
        let raw = XDriveIOSNativeFilesNode(
            id: 15, parent_id: 2, name: "camera.CR3", type: "file",
            size: 150_000_000, revision: 2
        )
        assertThat(P.canRequest(image), "HEIC thumbnail eligible without original-size cap")
        assertThat(P.canRequest(video) && P.isVideo(video), "video poster request")
        assertThat(P.canRequest(raw), "RAW derivative eligible")
        assertThat(!P.canRequest(pdf), "PDF does not trigger media endpoint")
        assertThat(!P.canRequest(folder) && !P.canRequest(root),
                   "no folder/root media requests")
        assertThat(!P.isVideo(image), "still is not video")
        assertThat(P.acceptedMIME("image/jpeg; charset=binary"), "valid jpeg")
        assertThat(P.acceptedMIME("image/png"), "valid png")
        assertThat(!P.acceptedMIME(nil), "missing Content-Type")
        assertThat(!P.acceptedMIME("text/html"), "error page never decoded")
        assertThat(P.maximumBytes == 2 * 1_048_576, "bounded derivative")
        assertThat(P.maximumConcurrent == 2, "two global thumbnail requests")
        print("native Files thumbnail derivative policy: PASS")
    }
}
