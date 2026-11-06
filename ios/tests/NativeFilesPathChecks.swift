import Foundation

@main
struct XDriveIOSNativeFilesPathChecks {
    static func require(_ result: @autoclosure () -> Bool, _ message: String) {
        if !result() {
            fputs("Native Files path failed: \(message)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias Path = XDriveIOSNativeFilesPathPolicy
        require(Path.segments("/") == [], "root path is authorized root")
        require(Path.segments("/xDrive 云端/项目/图纸") == ["项目", "图纸"],
                "native root alias and Unicode components")
        require(Path.segments("我的文件\\项目\\图纸") == ["项目", "图纸"],
                "PWA-like backslash normalization")
        require(Path.segments("云端文件 / 项目 / 图纸 ") == ["项目", "图纸"],
                "trim each segment and accept cloud alias")
        require(Path.segments("") == nil, "empty user input is invalid")
        require(Path.segments(String(repeating: "x/", count: 33)) == nil,
                "cannot traverse more than 32 levels")
        require(Path.segments("/a/../b") == nil, "no parent-directory traversal")
        require(Path.segments("/./x") == nil, "no synthetic current-directory component")
        require(Path.segments("/" + String(repeating: "中", count: 86)) == nil,
                "reject more than 255 UTF-8 bytes per folder")
        require(Path.segments("/" + String(repeating: "a", count: 2050)) == nil,
                "bounded full-path bytes")

        let child = XDriveIOSNativeFilesNode(
            id: 44, parent_id: 7, name: "图纸", type: "dir",
            size: 0, revision: 3
        )
        let page = XDriveIOSNativeFilesNamedPage(
            items: [child], has_more: false,
            sort: "name", order: "asc",
            next_cursor: nil
        )
        require(Path.validNamedChild(page, parentID: 7, exactName: "图纸"),
                "one exact Server-filtered directory")
        require(!Path.validNamedChild(page, parentID: 8, exactName: "图纸"),
                "reject alternate parent")
        require(!Path.validNamedChild(page, parentID: 7, exactName: "图纸2"),
                "reject prefix or different case/name")
        let none = XDriveIOSNativeFilesNamedPage(
            items: [], has_more: false,
            sort: "name", order: "asc",
            next_cursor: nil
        )
        require(Path.validNamedChild(none, parentID: 7, exactName: "absent"),
                "missing exact child is a verified empty result, never guessed")
        let unfiltered = XDriveIOSNativeFilesNamedPage(
            items: [child], has_more: true,
            sort: "name", order: "asc",
            next_cursor: "opaque-cursor"
        )
        require(!Path.validNamedChild(unfiltered, parentID: 7, exactName: "图纸"),
                "reject a page reporting more results than the exact-name request")
        let wrongSort = XDriveIOSNativeFilesNamedPage(
            items: [child], has_more: false,
            sort: "updated", order: "asc",
            next_cursor: nil
        )
        require(!Path.validNamedChild(wrongSort, parentID: 7, exactName: "图纸"),
                "reject other order")
        let file = XDriveIOSNativeFilesNode(
            id: 44, parent_id: 7, name: "图纸", type: "file",
            size: 64, revision: 3
        )
        let filePage = XDriveIOSNativeFilesNamedPage(
            items: [file], has_more: false,
            sort: "name", order: "asc",
            next_cursor: nil
        )
        require(!Path.validNamedChild(filePage, parentID: 7, exactName: "图纸"),
                "only open folder, not similarly named file")
        print("Native Files typed-path validation passed")
    }
}
