import Foundation

struct XDriveIOSNativeOCRTarget: Equatable {
    let id: UInt64
    let revision: UInt64
    let name: String
    let size: Int64
}

enum XDriveIOSNativeOCRFailure: Error { case invalidDetail, invalidReceipt }

enum XDriveIOSNativeOCRPolicy {
    private struct Detail: Decodable {
        struct Node: Decodable {
            let id: UInt64
            let revision: UInt64
            let name: String
            let size: Int64
            let type: String
        }
        let node: Node
        let ocr: XDriveIOSNativeOCRResult?
    }
    static func detail(_ bytes: Data, target: XDriveIOSNativeOCRTarget) throws -> XDriveIOSNativeOCRResult? {
        let detail = try JSONDecoder().decode(Detail.self, from: bytes)
        guard target.id > 0, target.revision > 0, target.size >= 0,
              detail.node.id == target.id, detail.node.revision == target.revision,
              detail.node.name == target.name, detail.node.size == target.size,
              detail.node.type == "file" else { throw XDriveIOSNativeOCRFailure.invalidDetail }
        return detail.ocr
    }
    static func acceptReanalysis(_ bytes: Data, ownerID: UInt64) throws {
        struct Receipt: Decodable { let owner_id: UInt64; let accepted: [String] }
        let receipt = try JSONDecoder().decode(Receipt.self, from: bytes)
        guard ownerID > 0, receipt.owner_id == ownerID, receipt.accepted == ["smart_search"] else {
            throw XDriveIOSNativeOCRFailure.invalidReceipt
        }
    }
}

/// Decoded only from an authenticated current-Node detail, never a wall/list.
struct XDriveIOSNativeOCRResult: Decodable {
    let state: String
    let text: String
    let reason: String
    enum CodingKeys: String, CodingKey { case state, text, reason }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = try c.decode(String.self, forKey: .state)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        guard ["ready", "pending", "running", "stale", "failed", "unavailable"].contains(state),
              text.unicodeScalars.count <= 8192, reason.utf8.count <= 64,
              state == "ready" || text.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .state, in: c,
                debugDescription: "Invalid OCR detail")
        }
    }
    var message: String {
        switch state {
        case "ready": return text.isEmpty ? "已识别，未检测到文字" : "识别完成"
        case "pending": return "等待后台识别"
        case "running": return "正在识别"
        case "stale": return "照片已更新，等待重新识别"
        case "failed":
            switch reason {
            case "model_timeout": return "识别超时"
            case "model_busy": return "识别模型繁忙"
            case "model_unreachable": return "无法连接识别模型"
            case "preview_unavailable": return "分析预览暂不可用"
            case "interrupted": return "识别已中断"
            default: return "识别失败"
            }
        default: return "暂无可用 OCR 结果，请检查服务器模型配置"
        }
    }
}
