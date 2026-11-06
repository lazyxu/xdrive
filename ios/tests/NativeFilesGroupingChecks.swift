import Foundation

@main
struct XDriveIOSNativeFilesGroupingChecks {
    static func require(_ condition: @autoclosure () -> Bool, _ label: String) {
        if !condition() {
            fputs("native Files grouping failed: \(label)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesGroupingPolicy
        require(P.validGrouping("none") && P.validGrouping("type") &&
                P.validGrouping("modified") && P.validGrouping("size"),
                "only canonical Go group names")
        require(!P.validGrouping("group_by") && !P.validGrouping("latest"),
                "unknown grouping never reaches Server")
        let groups = [
            XDriveIOSNativeFilesGroupIndex(
                key: "folder", item_count: 10, start_index: 0
            ),
            XDriveIOSNativeFilesGroupIndex(
                key: "ext:pdf", item_count: 100, start_index: 10
            ),
            XDriveIOSNativeFilesGroupIndex(
                key: "ext:png", item_count: 99_890, start_index: 110
            )
        ]
        require(P.validIndexes(groups, total: 100_000),
                "100k Owner directory with server-authoritative group boundaries")
        require(P.group(at: 0, indexes: groups)?.key == "folder",
                "folder first group")
        require(P.group(at: 64, indexes: groups)?.key == "ext:pdf",
                "64-row page may enter middle of a group")
        require(P.group(at: 256, indexes: groups)?.key == "ext:png",
                "256-row window still uses entire Server index")
        require(P.group(at: 100_000, indexes: groups) == nil,
                "never index outside total")
        require(P.heading(at: 64, firstVisible: true, indexes: groups,
                          grouping: "type") == "PDF 文件 · 100",
                "show logical group header at start of a sliding viewport")
        require(P.heading(at: 65, firstVisible: false, indexes: groups,
                          grouping: "type") == nil,
                "no duplicate header inside a group")
        require(P.heading(at: 110, firstVisible: false, indexes: groups,
                          grouping: "type") == "PNG 文件 · 99890",
                "emit group header at exact Server boundary")
        require(P.validIndexes([], total: 0),
                "Go omits empty groups on an empty directory")
        require(!P.validIndexes([], total: 1),
                "never synthesize nonempty grouped data without indexes")
        let overlap = [
            XDriveIOSNativeFilesGroupIndex(key: "folder", item_count: 10, start_index: 0),
            XDriveIOSNativeFilesGroupIndex(key: "ext:pdf", item_count: 10, start_index: 8)
        ]
        require(!P.validIndexes(overlap, total: 20), "reject overlapping groups")
        let missing = [
            XDriveIOSNativeFilesGroupIndex(key: "folder", item_count: 10, start_index: 1)
        ]
        require(!P.validIndexes(missing, total: 10), "reject missing prefix")
        let duplicate = [
            XDriveIOSNativeFilesGroupIndex(key: "folder", item_count: 10, start_index: 0),
            XDriveIOSNativeFilesGroupIndex(key: "folder", item_count: 10, start_index: 10)
        ]
        require(!P.validIndexes(duplicate, total: 20), "reject duplicate group keys")
        let invalid = [XDriveIOSNativeFilesGroupIndex(
            key: "month:2026-11", item_count: 0, start_index: 0
        )]
        require(!P.validIndexes(invalid, total: 0), "reject empty group")
        require(P.title(.init(key: "month:2026-11", item_count: 2,
                              start_index: 0), grouping: "modified") == "2026-11",
                "Server UTC modified-month title")
        require(P.title(.init(key: "medium", item_count: 2,
                              start_index: 0), grouping: "size") == "100 MiB–1 GiB",
                "Server size bucket label")
        let json = Data(#"{"items":[],"total_count":0,"offset":0,"limit":64,"sort":"name","order":"asc","groups":[]}"#.utf8)
        let decoded = try? JSONDecoder().decode(XDriveIOSNativeFilesRange.self, from: json)
        require(decoded?.groups?.isEmpty == true,
                "decode grouped Server Range without file materialization")
        let normal = Data(#"{"items":[],"total_count":0,"offset":0,"limit":64,"sort":"name","order":"asc"}"#.utf8)
        let ungrouped = try? JSONDecoder().decode(XDriveIOSNativeFilesRange.self, from: normal)
        require(ungrouped?.groups == nil, "backward compatible ungrouped Range")
        let probe = XDriveIOSNativeFilesRange(
            items: [XDriveIOSNativeFilesNode(
                id: 42, parent_id: 7, name: "work",
                type: "dir", size: 0, revision: 2
            )],
            total_count: 100_000, offset: 0, limit: 1,
            sort: "name", order: "asc", groups: groups
        )
        require(P.validFirstPageProbe(probe, parentID: 7,
                                      sort: "name", order: "asc"),
                "one-row authenticated first page validates 100k grouping")
        require(!P.validFirstPageProbe(probe, parentID: 8,
                                       sort: "name", order: "asc"),
                "probe cannot cross parent directory ownership")
        let malformedProbe = XDriveIOSNativeFilesRange(
            items: [], total_count: 100_000, offset: 0, limit: 1,
            sort: "name", order: "asc", groups: groups
        )
        require(!P.validFirstPageProbe(malformedProbe, parentID: 7,
                                       sort: "name", order: "asc"),
                "probe must contain the actual first node of a nonempty directory")
        print("native Files grouped Server Range policy passed")
    }
}
