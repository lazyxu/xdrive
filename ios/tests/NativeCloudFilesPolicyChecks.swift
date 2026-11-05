import Foundation

@main
struct XDriveIOSNativeFilesPageChecks {
    static func require(_ condition: @autoclosure () -> Bool, _ label: String) {
        if !condition() {
            fputs("native Files Range failed: \(label)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        let timestampJSON = Data(#"{"id":99,"parent_id":7,"name":"timestamped.txt","type":"file","size":12,"revision":1,"created_at":"2026-11-02T10:00:00Z","updated_at":"2026-11-02T10:30:00.123456789Z"}"#.utf8)
        let timestamped = try? JSONDecoder().decode(
            XDriveIOSNativeFilesNode.self, from: timestampJSON
        )
        require(timestamped?.createdDate != nil, "decode Server created_at")
        require(timestamped?.modifiedDate != nil, "decode RFC3339Nano updated_at")
        require(XDriveIOSNativeFilesDatePolicy.date(
            from: "2026-11-02T10:30:00Z"
        ) != nil, "whole-second Server timestamp")
        require(XDriveIOSNativeFilesDatePolicy.date(from: "invalid") == nil,
                "reject malformed timestamp")

        let parent: UInt64 = 7
        let nodes: [XDriveIOSNativeFilesNode] = (0..<64).map { index in
            XDriveIOSNativeFilesNode(
                id: UInt64(100 + index), parent_id: parent,
                name: "file-\(index).txt", type: "file",
                size: Int64(index), revision: 1
            )
        }
        let page = XDriveIOSNativeFilesRange(
            items: nodes, total_count: 100_000,
            offset: 0, limit: 64, sort: "name", order: "asc"
        )
        require(XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parent, offset: 0, sort: "name", order: "asc"
        ), "bounded 100k Owner directory first page")
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parent + 1, offset: 0, sort: "name", order: "asc"
        ), "reject foreign parent")
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parent, offset: 64, sort: "name", order: "asc"
        ), "reject mismatched offset")
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parent, offset: 0, sort: "updated", order: "desc"
        ), "reject stale sort")
        let repeated = XDriveIOSNativeFilesRange(
            items: [nodes[0], nodes[0]], total_count: 2,
            offset: 0, limit: 64, sort: "name", order: "asc"
        )
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            repeated, parentID: parent, offset: 0, sort: "name", order: "asc"
        ), "reject duplicate Node IDs")
        let empty = XDriveIOSNativeFilesRange(
            items: [], total_count: 100_000, offset: 0,
            limit: 64, sort: "name", order: "asc"
        )
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            empty, parentID: parent, offset: 0, sort: "name", order: "asc"
        ), "reject non-progressing page")
        for kind in [
            "all", "folder", "file", "image", "video", "audio", "pdf",
            "document", "spreadsheet", "presentation", "archive",
            "code", "text", "other"
        ] {
            require(XDriveIOSNativeFilesPagePolicy.validSearchKind(kind),
                    "accept shared Web search kind: \(kind)")
        }
        require(!XDriveIOSNativeFilesPagePolicy.validSearchKind("dir"),
                "reject unsupported Server kind")
        require(!XDriveIOSNativeFilesPagePolicy.validSearchKind("image&limit=0"),
                "reject invalid kind parameter")
        require(XDriveIOSNativeFilesPagePolicy.searchKindLabel("image") == "图片",
                "localized kind label")
        var structured = XDriveIOSNativeFilesSearchFilterState()
        structured.kind = "image"
        structured.modifiedFrom = "2026-11-01T00:00:00Z"
        structured.minSize = 0
        structured.maxSize = (1 << 20) - 1
        require(XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "valid Server date and size filters")
        structured.modifiedTo = "2026-11-02T00:00:00.000Z"
        require(XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "valid fractional RFC3339 upper bound")
        structured.modifiedFrom = "not-a-date"
        require(!XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "reject malformed modified_from")
        structured.modifiedFrom = "2026-11-03T00:00:00Z"
        structured.modifiedTo = "2026-11-02T00:00:00Z"
        require(!XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "reject reversed modified date range")
        structured.modifiedTo = nil
        structured.minSize = -1
        require(!XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "reject negative minimum size")
        structured.minSize = 100
        structured.maxSize = 99
        require(!XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "reject reversed size range")
        structured.minSize = nil
        structured.maxSize = nil
        structured.kind = "unknown"
        require(!XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "reject unsupported kind with structured filters")
        structured.kind = "all"
        structured.sourceID = 41
        structured.tagID = 9
        require(XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "valid Owner source and tag filters")
        require(XDriveIOSNativeFilesPagePolicy.validSearchRequest(query: "", filters: structured),
                "allow filter-only full-library search")
        require(XDriveIOSNativeFilesPagePolicy.validSearchRequest(query: "invoice", filters: structured),
                "allow text and structured filters together")
        structured.sourceID = 0
        require(!XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "reject zero source ID")
        structured.sourceID = 41
        structured.tagID = 0
        require(!XDriveIOSNativeFilesPagePolicy.validSearchFilters(structured),
                "reject zero tag ID")
        structured.sourceID = nil
        structured.tagID = nil
        structured.modifiedFrom = nil
        structured.modifiedTo = nil
        structured.minSize = nil
        structured.maxSize = nil
        structured.kind = "all"
        require(!XDriveIOSNativeFilesPagePolicy.validSearchRequest(query: "", filters: structured),
                "reject empty query without active filters")

        let sourceOptions = [
            XDriveIOSNativeFilesSearchSourceOption(id: 2, name: "Photos"),
            XDriveIOSNativeFilesSearchSourceOption(id: 3, name: "Documents")
        ]
        require(XDriveIOSNativeFilesPagePolicy.validSearchSources(sourceOptions),
                "accept verified Owner search sources")
        require(!XDriveIOSNativeFilesPagePolicy.validSearchSources([
            sourceOptions[0], sourceOptions[0]
        ]), "reject duplicate source IDs")
        require(!XDriveIOSNativeFilesPagePolicy.validSearchSources([
            XDriveIOSNativeFilesSearchSourceOption(id: 0, name: "Invalid")
        ]), "reject zero source ID in options")
        require(!XDriveIOSNativeFilesPagePolicy.validSearchSources([
            XDriveIOSNativeFilesSearchSourceOption(id: 4, name: "  ")
        ]), "reject empty source label")

        let tagOptions = [
            XDriveIOSNativeFilesSearchTagOption(id: 5, name: "Work", color: "#12ABEF"),
            XDriveIOSNativeFilesSearchTagOption(id: 6, name: "Archive")
        ]
        require(XDriveIOSNativeFilesPagePolicy.validSearchTags(tagOptions),
                "accept verified Owner tags")
        require(!XDriveIOSNativeFilesPagePolicy.validSearchTags([
            tagOptions[0], tagOptions[0]
        ]), "reject duplicate tag IDs")
        require(!XDriveIOSNativeFilesPagePolicy.validSearchTags([
            XDriveIOSNativeFilesSearchTagOption(id: 7, name: "Invalid", color: "red")
        ]), "reject malformed tag color")
        require(!XDriveIOSNativeFilesPagePolicy.validSearchTags([
            XDriveIOSNativeFilesSearchTagOption(id: 0, name: "Invalid")
        ]), "reject zero tag ID in options")

        require(XDriveIOSNativeFilesPagePolicy.validSearch(" hello "), "search string")
        require(!XDriveIOSNativeFilesPagePolicy.validSearch("a"), "reject single ASCII character")
        require(!XDriveIOSNativeFilesPagePolicy.validSearch("中"), "reject single Unicode scalar")
        require(XDriveIOSNativeFilesPagePolicy.validSearch("中文"), "two Unicode scalars are valid")
        require(XDriveIOSNativeFilesPagePolicy.validSearch(
            String(repeating: "😀", count: 64)
        ), "accept exactly 256 UTF-8 bytes")
        require(!XDriveIOSNativeFilesPagePolicy.validSearch(
            String(repeating: "😀", count: 65)
        ), "reject more than 256 UTF-8 bytes")
        require(XDriveIOSNativeFilesPagePolicy.validSearch(
            String(repeating: "x", count: 200)
        ), "accept 200 short characters")
        require(!XDriveIOSNativeFilesPagePolicy.validSearch("  "), "no empty search")
        require(!XDriveIOSNativeFilesPagePolicy.validSearch(String(repeating: "a", count: 201)),
                "bounded search string")
        require(!XDriveIOSNativeFilesPagePolicy.validOffset(65), "page boundary")
        let search = XDriveIOSNativeFilesSearchRange(
            items: nodes.map { XDriveIOSNativeFilesSearchHit(node: $0, path: "/\($0.name)") },
            total_count: 115_000, offset: 0, limit: 64,
            sort: "name", order: "asc"
        )
        require(XDriveIOSNativeFilesPagePolicy.validResults(
            search, offset: 0, sort: "name", order: "asc"
        ), "bounded full-library range")
        let badSearch = XDriveIOSNativeFilesSearchRange(
            items: [XDriveIOSNativeFilesSearchHit(node: nodes[0], path: "")],
            total_count: 1, offset: 0, limit: 64,
            sort: "name", order: "asc"
        )
        require(!XDriveIOSNativeFilesPagePolicy.validResults(
            badSearch, offset: 0, sort: "name", order: "asc"
        ), "reject missing search path")
        print("native Files bounded Owner Range checks passed")
    }
}
