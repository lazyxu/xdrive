import Foundation

/// Public Share URL is a browser capability route, never an API bearer URL.
/// This helper is pure so permission and URL decisions can be tested off-device.
enum XDriveIOSNativeFilesShareLinkPolicy {
    static let allowedExpiryDays: Set<Int> = [0, 1, 7, 30]

    static func validAccess(_ value: String, isDirectory: Bool) -> Bool {
        value == "read_only" || (isDirectory && value == "view_upload")
    }

    static func expiry(days: Int, now: Date) -> Date? {
        guard allowedExpiryDays.contains(days), days > 0 else { return nil }
        return now.addingTimeInterval(TimeInterval(days) * 86_400)
    }

    static func validToken(_ token: String) -> Bool {
        let scalars = token.unicodeScalars
        guard scalars.count == 43 else { return false }
        return scalars.allSatisfy { item in
            let value = item.value
            return (value >= 48 && value <= 57) ||
                (value >= 65 && value <= 90) ||
                (value >= 97 && value <= 122) || value == 45 || value == 95
        }
    }

    static func url(origin: URL, token: String) -> URL? {
        guard validToken(token),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme == "https", components.host?.isEmpty == false,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/" else { return nil }
        components.path = "/"
        components.fragment = "/s/\(token)"
        return components.url
    }
}