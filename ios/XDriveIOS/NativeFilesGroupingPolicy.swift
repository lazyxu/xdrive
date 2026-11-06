import Foundation

/// The Server's ordered GroupIndex is in NativeCloudFilesPolicy.swift.
enum XDriveIOSNativeFilesGroupingPolicy {
    static let supported = ["none", "type", "modified", "size"]

    static func validGrouping(_ group: String) -> Bool {
        supported.contains(group)
    }

    /// The authoritative index spans the whole Owner directory; groups may
    /// never skip, overlap, wrap or claim counts beyond the validated Range.
    static func validIndexes(_ groups: [XDriveIOSNativeFilesGroupIndex],
                             total: Int) -> Bool {
        guard total >= 0 && total <= XDriveIOSNativeFilesPagePolicy.maximumCount,
              groups.count <= 4096 else { return false }
        var nextStart = 0
        var seen = Set<String>()
        for group in groups {
            guard !group.key.isEmpty, group.key.utf8.count <= 96,
                  !seen.contains(group.key),
                  group.item_count > 0, group.item_count <= total - nextStart,
                  group.start_index == nextStart else { return false }
            seen.insert(group.key)
            nextStart += group.item_count
        }
        return nextStart == total
    }

    /// The Server supports an offset=0, limit=1 grouped probe. It returns
    /// the same whole-folder group indexes without fetching 64 extra Nodes
    /// when restoring a middle viewport.
    static func validFirstPageProbe(_ page: XDriveIOSNativeFilesRange,
                                    parentID: UInt64,
                                    sort: String, order: String) -> Bool {
        guard parentID > 0, page.offset == 0, page.limit == 1,
              page.sort == sort, page.order == order,
              XDriveIOSNativeFilesPagePolicy.validOrder(
                sort: sort, order: order
              ),
              page.total_count >= 0 &&
                page.total_count <= XDriveIOSNativeFilesPagePolicy.maximumCount,
              page.items.count == min(1, page.total_count),
              page.items.allSatisfy({
                $0.parent_id == parentID &&
                  $0.id > 0 && $0.revision > 0 &&
                  ($0.type == "dir" || $0.type == "file")
              }) else { return false }
        return validIndexes(page.groups ?? [], total: page.total_count)
    }

    static func group(at position: Int,
                      indexes: [XDriveIOSNativeFilesGroupIndex])
        -> XDriveIOSNativeFilesGroupIndex? {
        guard position >= 0 else { return nil }
        return indexes.first {
            position >= $0.start_index &&
                position - $0.start_index < $0.item_count
        }
    }

    static func title(_ index: XDriveIOSNativeFilesGroupIndex,
                      grouping: String) -> String {
        let key = index.key
        switch grouping {
        case "type":
            if key == "folder" { return "文件夹" }
            if key == "other" { return "其他类型" }
            if key.hasPrefix("ext:"), key.utf8.count > 4 {
                return key.dropFirst(4).uppercased() + " 文件"
            }
            return key
        case "modified":
            if key == "unknown" { return "修改日期未知" }
            if key.hasPrefix("month:"), key.count == 13 {
                return String(key.dropFirst(6))
            }
            return key
        case "size":
            switch key {
            case "folder": return "文件夹"
            case "empty": return "0 字节"
            case "tiny": return "小于 1 MiB"
            case "small": return "1–100 MiB"
            case "medium": return "100 MiB–1 GiB"
            case "large": return "至少 1 GiB"
            default: return key
            }
        default: return key
        }
    }

    static func heading(at position: Int, firstVisible: Bool,
                        indexes: [XDriveIOSNativeFilesGroupIndex],
                        grouping: String) -> String? {
        guard grouping != "none", let found = group(at: position, indexes: indexes),
              firstVisible || found.start_index == position else { return nil }
        return title(found, grouping: grouping) + " · " + String(found.item_count)
    }
}
