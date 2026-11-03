import Foundation

/// Explicit metadata search. It does not claim Apple Photos' on-device
/// people, scene, OCR or semantic indexing.
enum XDriveIOSNativePhotoSearchQueryPolicy {
    static func normalized(_ text: String) -> String? {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty,
              query.count <= 80, query.utf8.count <= 256,
              !query.unicodeScalars.contains(where: {
                  CharacterSet.controlCharacters.contains($0)
              })
        else { return nil }
        return query
    }

    static func matchesDate(_ date: Date?, query: String,
                            calendar: Calendar = .current) -> Bool {
        guard let date else { return false }
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = parts.year, let month = parts.month,
              let day = parts.day else { return false }
        let iso = String(format: "%04d-%02d-%02d", year, month, day)
        return iso.hasPrefix(query) || query == "\(year)年" ||
            query == "\(year)年\(month)月" ||
            query == "\(month)月" ||
            query == "\(month)月\(day)日"
    }

    static func matchesKind(_ kind: String, live: Bool,
                            screenshot: Bool, query: String) -> Bool {
        (kind == "video" && query == "视频") ||
        (kind == "image" && query == "照片") ||
        (kind == "image" && live && query == "实况") ||
        (kind == "image" && screenshot && query == "截屏")
    }
}
