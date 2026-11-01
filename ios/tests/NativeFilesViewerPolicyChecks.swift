import Foundation

@main
struct XDriveIOSNativeFilesViewerPolicyChecks {
    static func require(_ condition: @autoclosure () -> Bool, _ label: String) {
        if !condition() {
            fputs("native Files Viewer policy failed: \(label)\n", stderr)
            exit(1)
        }
    }

    static func node(
        _ id: UInt64, _ name: String = "photo.jpg",
        parent: UInt64 = 7, revision: UInt64 = 1, size: Int64 = 100
    ) -> XDriveIOSNativeFilesNode {
        XDriveIOSNativeFilesNode(
            id: id, parent_id: parent, name: name,
            type: "file", size: size, revision: revision
        )
    }

    static func main() {
        let first = node(10)
        let second = node(11, "clip.mp4")
        let third = node(12, "notes.txt", size: 0)
        let loaded = [first, second, third]
        require(XDriveIOSNativeFilesViewerPolicy.kind(for: "a.pdf") == .pdf,
                "PDF classification")
        require(XDriveIOSNativeFilesViewerPolicy.kind(for: "README") == .text,
                "extension-free text")
        require(XDriveIOSNativeFilesViewerPolicy.kind(for: "a.mp3") == .audio,
                "audio")
        require(XDriveIOSNativeFilesViewerPolicy.kind(for: "a.mkv") == .unsupported,
                "unsupported native video codec")
        require(XDriveIOSNativeFilesViewerPolicy.canPreview(third),
                "zero-byte text can show an empty document")
        require(XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: first, in: loaded, direction: 1, authorized: true
        ) == second, "next file in one verified page")
        require(XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: second, in: loaded, direction: -1, authorized: true
        ) == first, "previous file")
        require(XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: third, in: loaded, direction: 1, authorized: true
        ) == nil, "no out-of-page next")
        require(XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: first, in: loaded, direction: 2, authorized: true
        ) == nil, "only adjacent directions")
        require(XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: first, in: loaded, direction: 1, authorized: false
        ) == nil, "Owner revocation")
        require(XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: node(10, revision: 2), in: loaded, direction: 1,
            authorized: true
        ) == nil, "stale Node revision")
        require(XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: first, in: [first, first], direction: 1,
            authorized: true
        ) == nil, "duplicate Node IDs")
        require(XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: first, in: [first, node(20, parent: 8)],
            direction: 1, authorized: true
        ) == nil, "cross-directory navigation")
        require(XDriveIOSNativeFilesViewerPolicy.neighbor(
            current: first, in: (0..<65).map { node(UInt64($0 + 1)) },
            direction: 1, authorized: true
        ) == nil, "overlong page")
        require(!XDriveIOSNativeFilesViewerPolicy.canPreview(
            node(15, "huge.pdf", size: 65 * 1_048_576)
        ), "bounded PDF")
        require(!XDriveIOSNativeFilesViewerPolicy.canPreview(
            node(15, "huge.jpg", size: 33 * 1_048_576)
        ), "bounded original still")
        require(XDriveIOSNativeFilesViewerPolicy.validTicketPath(
            "/api/v1/file-preview/11?ticket=one", nodeID: 11
        ), "same-origin relative signed URL")
        for bad in [
            "https://example.com/api/v1/file-preview/11?ticket=one",
            "//elsewhere/api/v1/file-preview/11?ticket=one",
            "/api/v1/file-preview/12?ticket=one",
            "/api/v1/file-preview/11?ticket=one&extra=1",
            "/api/v1/file-preview/11?ticket=",
            "/api/v1/file-preview/11?ticket=one#fragment",
            "/api/v1/file-preview/%31%31?ticket=one"
        ] {
            require(!XDriveIOSNativeFilesViewerPolicy.validTicketPath(
                bad, nodeID: 11
            ), "reject altered ticket URL")
        }
        require(XDriveIOSNativeFilesViewerPolicy.validTicketType(
            kind: .pdf, ticketKind: "pdf", mime: "application/pdf"
        ), "PDF ticket type")
        require(!XDriveIOSNativeFilesViewerPolicy.validTicketType(
            kind: .pdf, ticketKind: "image", mime: "image/jpeg"
        ), "refuse mistyped media")
        print("native Files Viewer policy: PASS")
    }
}
