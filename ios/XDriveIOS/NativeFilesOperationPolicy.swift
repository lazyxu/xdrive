import Foundation

/// The Server owns operation lineage, 409 conflict handling and the atomic
/// undo/redo queue. Native displays only authorized, bounded operations.
struct XDriveIOSNativeFilesOperation: Decodable, Identifiable, Equatable {
    let id: String
    let type: String
    let status: String
    let undo_of_id: String?
    let undone_by_id: String?
    let redo_of_id: String?
    let redone_by_id: String?
    let undoable: Bool
    let redoable: Bool
    let total_items: Int64
    let processed_items: Int64
    let created_at: String
    let updated_at: String
}

enum XDriveIOSNativeFilesOperationPolicy {
    static let maximumHistory = 50

    enum Action: String {
        case undo, redo
        var label: String { self == .undo ? "撤销" : "重做" }
    }

    static func valid(_ item: XDriveIOSNativeFilesOperation) -> Bool {
        UUID(uuidString: item.id) != nil &&
            ["copy", "move", "delete", "undo", "redo"].contains(item.type) &&
            ["queued", "running", "cancel_requested", "cancelled",
             "completed", "failed"].contains(item.status) &&
            item.total_items >= 0 && item.total_items <= 10_000_000 &&
            item.processed_items >= 0 && item.processed_items <= item.total_items &&
            !item.created_at.isEmpty && item.created_at.utf8.count <= 96 &&
            !item.updated_at.isEmpty && item.updated_at.utf8.count <= 96 &&
            [item.undo_of_id, item.undone_by_id, item.redo_of_id,
             item.redone_by_id].allSatisfy {
                $0 == nil || UUID(uuidString: $0!) != nil
            }
    }

    static func validHistory(_ items: [XDriveIOSNativeFilesOperation]) -> Bool {
        items.count <= maximumHistory && Set(items.map(\.id)).count == items.count &&
            items.allSatisfy(valid)
    }

    static func canPerform(_ action: Action,
                           for item: XDriveIOSNativeFilesOperation) -> Bool {
        guard valid(item), item.status == "completed" else { return false }
        switch action {
        case .undo:
            return item.undoable && item.type != "undo" && item.undone_by_id == nil
        case .redo:
            return item.redoable && item.type == "undo" && item.redone_by_id == nil
        }
    }

    /// The POST returns HTTP 202: this is a queued lineage operation, never
    /// an already-completed filesystem mutation.
    static func accepted(_ queued: XDriveIOSNativeFilesOperation,
                         action: Action,
                         original: XDriveIOSNativeFilesOperation) -> Bool {
        valid(queued) && canPerform(action, for: original) &&
            queued.id != original.id && queued.type == action.rawValue &&
            (queued.status == "queued" || queued.status == "running") &&
            (action == .undo
                ? queued.undo_of_id == original.id
                : queued.redo_of_id == original.id)
    }

    static func title(_ operation: XDriveIOSNativeFilesOperation) -> String {
        switch operation.type {
        case "copy": return "复制"
        case "move": return "移动"
        case "delete": return "删除"
        case "undo": return "撤销"
        case "redo": return "重做"
        default: return "文件操作"
        }
    }

    static func statusLabel(_ status: String) -> String {
        switch status {
        case "queued": return "排队中"
        case "running": return "执行中"
        case "cancel_requested": return "请求取消"
        case "cancelled": return "已取消"
        case "completed": return "已完成"
        case "failed": return "失败"
        default: return "状态未知"
        }
    }
}
