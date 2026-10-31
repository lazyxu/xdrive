import Foundation

/// A deliberately narrow, HTTPS-only origin. Never attach credentials to a path,
/// another host, a redirected request, or a connection with invalid TLS identity.
enum ServerAddress {
    static func parse(_ input: String) throws -> URL {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty,
              value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              var parts = URLComponents(string: value),
              parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.percentEncodedQuery == nil, parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              parts.port == nil || (1...65535).contains(parts.port!)
        else { throw AuthFailure.invalidServer }
        parts.path = ""
        guard let url = parts.url else { throw AuthFailure.invalidServer }
        return url
    }
}

enum AuthFailure: Error {
    case invalidServer
    case invalidResponse
    case invalidLANIP
    case invalidLANProbe
    case redirectRefused
    case rejected
    case rateLimited
    case unavailable
    case httpStatus(Int)

    static func message(for error: Error) -> String {
        if let failure = error as? AuthFailure {
            switch failure {
            case .invalidServer:
                return "请输入完整的 HTTPS 服务器地址，不包含路径或查询参数。"
            case .invalidResponse:
                return "服务器返回的数据格式不正确，请确认这是 xDrive 服务。"
            case .invalidLANIP:
                return "内网 IP 必须是规范的私有 IPv4 地址；服务器本身使用 IP 时请留空此选项。"
            case .invalidLANProbe:
                return "内网 IP 未返回有效的 xDrive HTTPS 版本信息；为保护登录凭据已停止连接。"
            case .redirectRefused:
                return "登录请求被重定向，请直接填写正确的 HTTPS 服务器地址。"
            case .rejected:
                return "用户名或密码错误，或会话已失效。"
            case .rateLimited:
                return "请求过于频繁，请稍后重试。"
            case .unavailable:
                return "服务器暂时不可用，请稍后重试。"
            case .httpStatus(let status):
                return "服务器请求失败（HTTP \(status)）。"
            }
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .secureConnectionFailed, .serverCertificateUntrusted,
                 .serverCertificateHasBadDate, .serverCertificateNotYetValid,
                 .serverCertificateHasUnknownRoot:
                return "HTTPS 证书验证失败，请先在 iPhone 中正确安装并信任服务器 CA。"
            case .cannotFindHost, .dnsLookupFailed, .cannotConnectToHost,
                 .networkConnectionLost, .notConnectedToInternet:
                return "无法连接服务器，请检查地址、网络和服务器状态。"
            case .timedOut:
                return "连接超时，请稍后重试。"
            default:
                break
            }
        }
        return "连接失败，请检查 HTTPS 地址和网络后重试。"
    }
}

struct AuthResponse: Decodable {
    let access_token: String?
    let token: String?
    let refresh_token: String
    let username: String
    let must_change_password: Bool?

    var isValid: Bool {
        let access = [access_token, token].compactMap { $0 }.first { !$0.isEmpty }
        return access != nil && !refresh_token.isEmpty && !username.isEmpty
    }
}

/// URLSession's normal redirect behavior is inappropriate for credentials.
/// Redirects are rejected even if the destination appears to be same-origin.
private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct AuthService {
    let origin: URL

    func login(username: String, password: String) async throws -> AuthResponse {
        try await authenticate("auth/login", fields: [
            "username": username,
            "password": password
        ])
    }

    func refresh(token: String) async throws -> AuthResponse {
        try await authenticate("auth/refresh", fields: ["refresh_token": token])
    }

    func logout(token: String) async throws {
        _ = try await post("auth/logout", fields: ["refresh_token": token])
    }

    private func authenticate(_ path: String, fields: [String: String]) async throws -> AuthResponse {
        let data = try await post(path, fields: fields)
        guard data.count <= 65_536,
              let result = try? JSONDecoder().decode(AuthResponse.self, from: data),
              result.isValid
        else { throw AuthFailure.invalidResponse }
        return result
    }

    private func post(_ path: String, fields: [String: String]) async throws -> Data {
        guard var address = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
            throw AuthFailure.invalidServer
        }
        address.path = "/api/v1/\(path)"
        guard let url = address.url else { throw AuthFailure.invalidServer }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: fields)

        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 20
        let session = URLSession(configuration: config, delegate: RejectRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }

        let (data, reply) = try await session.data(for: request)
        guard let http = reply as? HTTPURLResponse else { throw AuthFailure.invalidResponse }
        switch http.statusCode {
        case 200..<300: return data
        case 300..<400: throw AuthFailure.redirectRefused
        case 400, 401, 403: throw AuthFailure.rejected
        case 429: throw AuthFailure.rateLimited
        case 503: throw AuthFailure.unavailable
        default: throw AuthFailure.httpStatus(http.statusCode)
        }
    }
}
