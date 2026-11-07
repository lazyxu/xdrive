import Foundation

/// Available before authentication so a failed login can identify its binary.
enum XDriveIOSNativeBuildIdentity {
    static var label: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "未知"
        guard let commit = info["XDriveSourceCommit"] as? String,
              commit.utf8.count == 40,
              commit.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            return "客户端版本 \(version) · 构建号未提供"
        }
        return "客户端版本 \(version) · 构建 \(commit.prefix(12))"
    }
}
