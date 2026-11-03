import Foundation

@main
struct NativeNotesManualImportPolicyChecks {
    static func main() throws {
        typealias Policy = XDriveIOSNativeManualNotesImportPolicy

        let markdown = """
        # 会议记录 📝

        ![照片 😀](assets/家庭照片.png)
        [下载文档](assets/家庭照片.png)
        ![另一张](photo.jpg)
        ![重复](assets/家庭照片.png)
        """
        let names = try Policy.references(in: markdown)
        precondition(names == ["家庭照片.png", "photo.jpg"], "must find exact Markdown image refs")
        let selected = try Policy.selectedImages(
            requiredNames: names, availableNames: ["photo.jpg", "家庭照片.png", "unused.gif"]
        )
        precondition(selected == names, "must import only referenced images")

        let noteID = "12345678-1234-1234-1234-123456789abc"
        let asset = "_assets/" + noteID + "/abcdef12-abcd-4321-abcd-123456789abc.png"
        let rewritten = try Policy.replacing(
            markdown, filename: "家庭照片.png",
            with: asset, noteID: noteID
        )
        precondition(rewritten.contains("![照片 😀](" + asset + ")"))
        precondition(rewritten.contains("![重复](" + asset + ")"))
        precondition(rewritten.contains("[下载文档](assets/家庭照片.png)"),
                     "non-image Markdown links must not be rewritten")
        precondition(rewritten.contains("![另一张](photo.jpg)"),
                     "other images must keep their own references")

        for unsafe in [
            "https://example.com/a.jpg", "//evil.test/pic.png", "/private/a.jpg",
            "../private/a.jpg", "assets/../../private.jpg", "file:///secret.jpg",
            "data:image/png;base64,a", "assets/%2e%2e/a.png",
            "assets\\photo.png", "photo.jpg?session=secret", "assets//photo.jpg",
        ] {
            precondition((try? Policy.localImageFilename(unsafe)) == nil, unsafe)
        }
        precondition((try? Policy.selectedImages(
            requiredNames: ["photo.jpg"], availableNames: ["other.jpg"]
        )) == nil, "missing image cannot be marked complete")
        precondition((try? Policy.selectedImages(
            requiredNames: ["photo.jpg"], availableNames: ["photo.jpg", "photo.jpg"]
        )) == nil, "ambiguous selected image must be rejected")
        precondition((try? Policy.replacing(
            markdown, filename: "photo.jpg",
            with: "_assets/other-owner/image.jpg", noteID: noteID
        )) == nil, "foreign asset path cannot replace a local reference")
        precondition((try? Policy.references(
            in: "![remote](https://outside.example/image.png)"
        )) == nil, "never fetch remote Markdown images")
        print("Native Notes explicit Markdown and image import policy: PASS")
    }
}
