import Foundation

/// No live Server, user password, Keychain secrets or TLS bypass are involved.
@main struct NativeOwnerLoginFailureChecks {
    static func main() {
        typealias Policy = XDriveIOSNativeOwnerLoginFailurePolicy
        let generic = "无法验证当前服务器、账户或云端根目录；未建立原生会话。"
        let cases: [(String, Error, String, Bool)] = [
            ("LAN certificate identity", URLError(.serverCertificateUntrusted), "IP", false),
            ("Certificate validity", URLError(.serverCertificateHasBadDate), "有效期", false),
            ("Transport timeout", URLError(.timedOut), "连接超时", true),
            ("Transport disconnected", URLError(.cannotConnectToHost), "无法连接", true),
            ("Missing instance identity", XDriveNativeOwnerRootFailure.missingServerIdentity, "/api/v1/me", false),
            ("Owner mismatch", XDriveNativeOwnerRootFailure.ownerChanged, "账户身份", false),
            ("Invalid root response", XDriveNativeOwnerRootFailure.invalidServerReply, "/api/v1/nodes/root", false),
            ("Owner/root 401", XDriveNativeOwnerRootFailure.serverStatus(401), "HTTP 401", false),
            ("Owner/root 403", XDriveNativeOwnerRootFailure.serverStatus(403), "HTTP 403", false),
            ("Owner/root 429", XDriveNativeOwnerRootFailure.serverStatus(429), "HTTP 429", true),
            ("Owner/root 503", XDriveNativeOwnerRootFailure.serverStatus(503), "HTTP 503", true),
            ("Login invalid password", AuthFailure.rejected, "用户名或密码", false),
            ("Keychain unavailable", XDriveIOSNativeSessionError.keychainUnavailable(-25291), "Keychain", false),
            ("Owner scope drift", XDriveIOSNativeSessionError.ownerChanged, "服务器或账户", false),
        ]
        for (name, error, required, retryable) in cases {
            let message = Policy.message(for: error)
            precondition(message != generic, "\(name): error must not be collapsed")
            precondition(message.contains(required), "\(name): missing safe diagnostic")
            precondition(Policy.canRetrySavedSession(after: error) == retryable,
                         "\(name): wrong automatic/manual retry eligibility")
        }
        for error in [XDriveNativeOwnerRootFailure.invalidSession,
                      XDriveNativeOwnerRootFailure.serverStatus(404),
                      AuthFailure.invalidLANProbe,
                      URLError(.secureConnectionFailed)] as [Error] {
            precondition(!Policy.canRetrySavedSession(after: error),
                         "Identity or malformed-Server errors cannot retry")
        }
        print("iOS native login failure diagnostics: \(cases.count) injected errors classified, bounded retry gates passed")
    }
}
