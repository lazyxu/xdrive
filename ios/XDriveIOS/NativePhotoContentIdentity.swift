import Foundation

enum XDriveIOSNativePhotoContentPolicy {
    static func valid(_ key: String) -> Bool {
        let prefixes = ["sha256:", "photo-bundle:v1:sha256:"]
        guard let prefix = prefixes.first(where: { key.hasPrefix($0) }) else { return false }
        let hash = key.dropFirst(prefix.count)
        return hash.utf8.count == 64 && hash.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

struct XDriveIOSNativeMediaPerson: Decodable, Identifiable, Equatable {
    let id: String
    let name: String?
    let item_count: Int
    var suggested: Bool { id.hasPrefix("auto:v1:") }
    var title: String { suggested ? "人物建议" : ((name?.isEmpty == false) ? name! : "未命名人物") }
    var isValid: Bool {
        guard (0...10_000_000).contains(item_count) else { return false }
        if suggested {
            return XDriveIOSNativePhotoContentPolicy.valid("sha256:" + String(id.dropFirst("auto:v1:".count)))
        }
        guard id.hasPrefix("person:v1:"), let name, name.utf8.count <= 256 else { return false }
        let uuid = String(id.dropFirst("person:v1:".count))
        return UUID(uuidString: uuid)?.uuidString.lowercased() == uuid
    }
}
