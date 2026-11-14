import Foundation

/// Safe, user-facing native sign-in and Keychain restoration error classifier.
/// A failed Owner/root check never creates an authenticated Session. Do not
/// include response bodies, raw errors, passwords, bearer tokens or Keychain
/// identifiers in UI feedback.
enum XDriveIOSNativeOwnerLoginFailurePolicy {
    static func message(for failure: Error) -> String {
        if let local = failure as? XDriveIOSNativeSessionError {
            switch local {
            case .malformedCredential:
                return "本机保持登录记录不可验证；未读取或替换其他账户。请明确退出并重新登录。"
            case .keychainUnavailable:
                return "iOS Keychain 暂不可用；登录凭据未确认保存或清除。请解锁后重试。"
            case .staleSession, .ownerChanged:
                return "服务器或账户在验证期间发生变化；未建立原生登录会话。"
            case .passwordChangeRequired:
                return "当前账户要求修改密码；原生密码修改页面尚未接入，未建立会话。"
            case .notSignedIn:
                return "当前没有经过验证的原生登录会话。"
            }
        }
        if let owner = failure as? XDriveNativeOwnerRootFailure {
            switch owner {
            case .invalidSession:
                return "本机原生授权信息不完整；未验证 Server 身份或云端根目录。"
            case .missingServerIdentity:
                return "Server 的 /api/v1/me 缺少安装实例标识；请检查 Server 版本和配置，未建立原生会话。"
            case .ownerChanged:
                return "Server 返回的账户身份或密码状态与当前登录不符；未建立原生会话。"
            case .invalidServerReply:
                return "Server 的 /api/v1/me 或 /api/v1/nodes/root 响应数据无效；未建立原生会话。"
            case .serverStatus(let status):
                if status == 401 || status == 403 {
                    return "Server 账户或云端根目录验证未授权（HTTP \(status)）；请重新登录并核对账号权限。"
                }
                if status == 404 {
                    return "Server 账户或云端根目录接口返回 HTTP 404；请检查 Server 版本和该账号的根目录。"
                }
                if status == 429 || (500...599).contains(status) {
                    return "Server 账户或云端根目录验证暂时失败（HTTP \(status)）；可在网络恢复后重试。"
                }
                return "Server 账户或云端根目录验证失败（HTTP \(status)）；未建立原生会话。"
            }
        }
        // AuthFailure.message already provides safe TLS/network diagnostics.
        // Previously URLError bypassed it and fell through to the screenshot's
        // generic string, masking certificate identity and connectivity faults.
        if failure is AuthFailure || failure is URLError {
            return AuthFailure.message(for: failure)
        }
        return "无法验证当前服务器、账户或云端根目录；未建立原生会话。"
    }

    /// Stable diagnostic *codes* only. Never turn Error.localizedDescription,
    /// underlying URLSession userInfo, request URLs or response bodies into UI:
    /// those may carry authenticated endpoints and secrets.
    static func diagnosticCode(for failure: Error) -> String {
        if let error = failure as? URLError {
            return "URLSession NSURLErrorDomain \(error.code.rawValue)"
        }
        if let error = failure as? XDriveIOSNativeSessionError {
            switch error {
            case .keychainUnavailable(let osStatus):
                return "Keychain OSStatus \(osStatus)"
            case .malformedCredential: return "OWNER_SESSION_MALFORMED"
            case .staleSession: return "OWNER_SESSION_STALE"
            case .ownerChanged: return "OWNER_SESSION_CHANGED"
            case .passwordChangeRequired: return "OWNER_PASSWORD_CHANGE_REQUIRED"
            case .notSignedIn: return "OWNER_SESSION_NOT_SIGNED_IN"
            }
        }
        if let error = failure as? XDriveNativeOwnerRootFailure {
            switch error {
            case .serverStatus(let status): return "OWNER_ROOT HTTP \(status)"
            case .invalidSession: return "OWNER_ROOT_INVALID_SESSION"
            case .missingServerIdentity: return "OWNER_ROOT_MISSING_SERVER_ID"
            case .ownerChanged: return "OWNER_ROOT_IDENTITY_CHANGED"
            case .invalidServerReply: return "OWNER_ROOT_INVALID_REPLY"
            }
        }
        if let error = failure as? AuthFailure {
            switch error {
            case .httpStatus(let status): return "AUTH HTTP \(status)"
            case .invalidServer: return "AUTH_INVALID_SERVER"
            case .invalidResponse: return "AUTH_INVALID_RESPONSE"
            case .invalidLANIP: return "AUTH_INVALID_LAN_IP"
            case .invalidLANProbe: return "AUTH_INVALID_LAN_PROBE"
            case .redirectRefused: return "AUTH_REDIRECT_REFUSED"
            case .rejected: return "AUTH_REJECTED"
            case .rateLimited: return "AUTH_RATE_LIMITED"
            case .unavailable: return "AUTH_UNAVAILABLE"
            }
        }
        return "UNCLASSIFIED_FAILURE"
    }

    /// Only a user click may initiate a new saved refresh. Retry the *same*
    /// Keychain Owner after transport errors or real 429/5xx, not bad TLS,
    /// malformed /me, identity drift, credential revocation or invalid roots.
    static func canRetrySavedSession(after failure: Error) -> Bool {
        if let owner = failure as? XDriveNativeOwnerRootFailure {
            if case .serverStatus(let status) = owner {
                return status == 429 || (500...599).contains(status)
            }
            return false
        }
        if let auth = failure as? AuthFailure {
            switch auth {
            case .rateLimited, .unavailable: return true
            case .httpStatus(let status): return (500...599).contains(status)
            default: return false
            }
        }
        guard let network = failure as? URLError else { return false }
        switch network.code {
        case .cannotFindHost, .dnsLookupFailed, .cannotConnectToHost,
             .networkConnectionLost, .notConnectedToInternet, .timedOut:
            return true
        default:
            return false
        }
    }
}
