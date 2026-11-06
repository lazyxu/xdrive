import Foundation

@main
struct XDriveIOSNativeFilesSelectionChecks {
    static func require(_ ok: @autoclosure () -> Bool, _ message: String) {
        if !ok() {
            fputs("Native Files cross-window selection failed: \(message)\n", stderr)
            exit(1)
        }
    }

    static func node(_ id: UInt64, parent: UInt64 = 7,
                     revision: UInt64 = 1) -> XDriveIOSNativeFilesNode {
        XDriveIOSNativeFilesNode(
            id: id, parent_id: parent, name: "file-\(id).txt",
            type: "file", size: 128, revision: revision
        )
    }

    static func main() {
        typealias Selection = XDriveIOSNativeFilesSelectionPolicy
        let ids: Set<UInt64> = [3, 65, 130, 199]
        let stored = Dictionary(uniqueKeysWithValues: ids.map { ($0, node($0)) })
        let chosen = Selection.validItems(
            snapshots: stored, selectedIDs: ids, parentID: 7
        )
        require(chosen?.map(\.id) == [3, 65, 130, 199],
                "selected 200-cap snapshots survive multiple 64-row evictions")
        require(Selection.conflictingIDs(
            visible: (300..<364).map { node(UInt64($0)) },
            snapshots: stored
        ).isEmpty, "eviction of all old selected nodes is not deselection")
        require(Selection.conflictingIDs(
            visible: [node(65), node(130, revision: 2), node(199, parent: 8)],
            snapshots: stored
        ) == Set<UInt64>([130, 199]),
                "only reappearing changed node revision/parent is stale")
        require(Selection.validItems(snapshots: stored,
                                     selectedIDs: ids.union([900]),
                                     parentID: 7) == nil,
                "no selected ID without exact verified Node snapshot")
        require(Selection.validItems(snapshots: stored,
                                     selectedIDs: ids.subtracting([199]),
                                     parentID: 7) == nil,
                "no stale extra snapshot when selection was cleared")
        require(Selection.validItems(snapshots: stored,
                                     selectedIDs: ids,
                                     parentID: 8) == nil,
                "cannot submit Nodes selected from a different directory")
        require(Selection.validItems(snapshots: [:],
                                     selectedIDs: [],
                                     parentID: 7) == nil,
                "no empty batch transaction")
        let full = (1...200).map { UInt64($0) }
        let fullStore = Dictionary(uniqueKeysWithValues: full.map { ($0, node($0)) })
        require(Selection.validItems(snapshots: fullStore,
                                     selectedIDs: Set(full),
                                     parentID: 7)?.count == 200,
                "exact Server 200 item mutation cap")
        let overflow = (1...201).map { UInt64($0) }
        let overflowStore = Dictionary(uniqueKeysWithValues: overflow.map { ($0, node($0)) })
        require(Selection.validItems(snapshots: overflowStore,
                                     selectedIDs: Set(overflow),
                                     parentID: 7) == nil,
                "cannot select 201 nodes even across many windows")
        print("Native Files cross-window selection policy passed")
    }
}
