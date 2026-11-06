import Foundation

/// Shared criteria for the canonical merged row, independent of its storage.
struct XDriveIOSNativeUnifiedGalleryQuery: Equatable {
    enum Media: String, CaseIterable, Identifiable {
        case all, image, video, live
        var id: Self { self }
        var title: String {
            switch self {
            case .all: return "所有媒体"
            case .image: return "照片"
            case .video: return "视频"
            case .live: return "实况照片"
            }
        }
    }

    var text = ""
    var media: Media = .all
    var from: Date?
    var until: Date?
    var term: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    var isValid: Bool {
        term.count <= 120 && (from == nil || until == nil || from! < until!)
    }

    func matches(video: Bool, live: Bool, capturedAt: Date?, names: [String]) -> Bool {
        guard isValid else { return false }
        switch media {
        case .all: break
        case .image: if video { return false }
        case .video: if !video { return false }
        case .live: if !live { return false }
        }
        if let from { guard let capturedAt, capturedAt >= from else { return false } }
        if let until { guard let capturedAt, capturedAt < until else { return false } }
        return term.isEmpty || names.contains { $0.localizedStandardContains(term) }
    }
}

/// Historical pages retain only source offsets, counts and a measured height.
/// Original IDs, decoded images and media arrays belong to visible views only.
struct XDriveIOSNativeUnifiedPageIndex<Cursor: Equatable> {
    struct Page: Identifiable {
        let id: Int
        let start: Cursor
        var end: Cursor?
        var count: Int?
        var height: Double = 160
    }
    private(set) var pages: [Page]

    init(start: Cursor) { pages = [Page(id: 0, start: start)] }

    mutating func commit(page: Int, count: Int, next: Cursor?) -> Bool {
        guard pages.indices.contains(page), (0...48).contains(count),
              next != pages[page].start else { return false }
        if let previousCount = pages[page].count {
            return previousCount == count && pages[page].end == next
        }
        guard page == pages.count - 1 else { return false }
        pages[page].count = count
        pages[page].end = next
        if let next { pages.append(Page(id: pages.count, start: next)) }
        return true
    }

    mutating func measure(page: Int, height: Double) {
        guard pages.indices.contains(page), height.isFinite, height >= 1 else { return }
        pages[page].height = height
    }
}

enum XDriveIOSNativePhotoPairingReason: String, Identifiable {
    case checking, localUnavailable, duplicate, permission, libraryIncomplete, cloudUnavailable, cloudIdentity
    var id: Self { self }
    var explanation: String {
        switch self {
        case .checking: return "正在核对完整原件的 SHA-256。"
        case .localUnavailable: return "本机原件暂不可读，可能仅保存在 iCloud。可在查看器中获取原件后重新核对。"
        case .duplicate: return "存在多个内容相同的候选，暂时分别保留，避免合并错照片。"
        case .permission: return "本机照片访问权限不完整，无法确认云端照片是否也在本机。"
        case .libraryIncomplete: return "本机原件索引尚未覆盖这类媒体，完成核对后会自动更新。"
        case .cloudUnavailable: return "云端暂不可用或不支持精确核对。重新连接后可重试。"
        case .cloudIdentity: return "云端原件身份尚未就绪或已经变化，需要服务器完成媒体分析后重新核对。"
        }
    }
}
