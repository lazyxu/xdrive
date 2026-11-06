import Foundation

@main
struct XDriveIOSNativeFilesSavedSearchChecks {
    static func require(_ value: @autoclosure () -> Bool, _ name: String) {
        if !value() {
            fputs("iOS saved searches failed: \(name)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias Policy = XDriveIOSNativeFilesSavedSearchPolicy
        var filters = XDriveIOSNativeFilesSearchFilterState()
        let empty = XDriveIOSNativeFilesSavedSearchFilters(from: filters)
        require(!Policy.validInput(name: "empty", query: "", filters: empty),
                "reject empty query and empty filters")
        require(Policy.validInput(name: "Reports", query: "report", filters: empty),
                "accept valid keyword-only saved search")
        require(!Policy.validInput(name: "Reports", query: "a", filters: empty),
                "reject Server-invalid short query")
        require(!Policy.validInput(name: " Reports ", query: "report", filters: empty),
                "never submit unnormalized names")
        require(!Policy.validInput(name: String(repeating: "x", count: 129),
                                   query: "report", filters: empty),
                "limit name by UTF-8 bytes")
        require(Policy.normalizedName(" 报表 ") == "报表",
                "trim names without corrupting Chinese Unicode")
        require(Policy.normalizedName(String(repeating: "😀", count: 33)) == nil,
                "reject more than 128 UTF-8 bytes")
        filters.kind = "pdf"
        filters.sourceID = 42
        filters.tagID = 5
        filters.minSize = 10
        let structured = XDriveIOSNativeFilesSavedSearchFilters(from: filters)
        require(Policy.validInput(name: "PDF 汇总", query: "", filters: structured),
                "allow structured-only saved search")
        require(structured.native == filters, "lossless structured Server filter projection")
        let encoded = try! JSONEncoder().encode(structured)
        let decoded = try! JSONDecoder().decode(
            XDriveIOSNativeFilesSavedSearchFilters.self, from: encoded
        )
        require(decoded == structured, "same JSON for PWA and native filters")
        require(String(data: try! JSONEncoder().encode(empty),
                       encoding: .utf8) == "{}",
                "omit unavailable 'all' kind rather than sending invalid value")
        let fixture = Data(#"{"id":11,"name":"PDF 汇总","query":"","filters":{"kind":"pdf","sourceID":42,"tagID":5,"minSize":10},"position":0,"created_at":"2026-11-05T00:00:00Z"}"#.utf8)
        let saved = try! JSONDecoder().decode(
            XDriveIOSNativeFilesSavedSearch.self, from: fixture
        )
        require(Policy.valid(saved), "accept actual Server saved-search JSON")
        require(saved.filters.native.sourceID == 42, "preserve Owner source filter")
        require(saved.filters.native.tagID == 5, "preserve Owner tag filter")
        require(Policy.validList([saved]), "valid exact Server list")
        require(!Policy.validList([saved, saved]), "reject duplicate ID or name")
        require(!Policy.validReorder([], items: [saved]),
                "reorder must cover all current Owner IDs")
        require(!Policy.validReorder([11,11], items: [saved]),
                "reject duplicate ID")
        require(Policy.validReorder([11], items: [saved]), "exact authenticated order")
        let bad = Data(#"{"id":0,"name":"bad","query":"bad","filters":{},"position":0}"#.utf8)
        let rejected = try! JSONDecoder().decode(
            XDriveIOSNativeFilesSavedSearch.self, from: bad
        )
        require(!Policy.valid(rejected), "reject missing identity")
        print("Native Files Saved Searches portable contract passed")
    }
}
