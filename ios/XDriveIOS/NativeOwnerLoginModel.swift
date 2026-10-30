import Combine
import Foundation

/// Native SwiftUI login controller. No PWA cookies, no WKWebView, no
/// permanent access-token storage and no unauthenticated device upload.
@MainActor
final class XDriveIOSNativeOwnerLoginModel: ObservableObject {
    @Published var serverText = ""
    @Published var username = ""
    @Published var password = ""
    @Published var keepSignedIn = true
    @Published private(set) var busy = false
    @Published private(set) var owner: XDriveNativeOwnerRoot?
    @Published private(set) var errorMessage: String?
    @Published private(set) var noticeMessage: String?

    private struct Session {
        let origin: URL
        let username: String
        let accessToken: String
        let refreshToken: String
        let verifiedOwner: XDriveNativeOwnerRoot
    }

    private var active: Session?
    private var generation: UInt64 = 0
    private var restoreAttempted = false

    init() {
        // A previously chosen Web server is ONLY a non-secret suggestion.
        // No old browser Cookie/Keychain refresh is imported or revived.
        serverText = UserDefaults.standard.string(
            forKey: "xdrive.ios.web.origin"
        ) ?? ""
    }

    private func currentAccessToken(_ response: AuthResponse) -> String? {
        [response.access_token, response.token]
            .compactMap { $0 }.first { !$0.isEmpty }
    }

    private func sameScope(
        _ a: XDriveNativeOwnerRoot, _ b: XDriveNativeOwnerRoot
    ) -> Bool {
        a.origin == b.origin &&
        a.instanceID == b.instanceID &&
        a.ownerID == b.ownerID &&
        a.username == b.username &&
        a.rootNodeID == b.rootNodeID
    }

    private func record(
        owner: XDriveNativeOwnerRoot, refreshToken: String
    ) -> XDriveIOSNativeOwnerCredential {
        XDriveIOSNativeOwnerCredential(
            origin: owner.origin.absoluteString,
            username: owner.username,
            serverInstanceID: owner.instanceID,
            ownerID: owner.ownerID,
            rootNodeID: owner.rootNodeID,
            refreshToken: refreshToken
        )
    }

    private func ownerMatchesSaved(
        _ verified: XDriveNativeOwnerRoot,
        saved: XDriveIOSNativeOwnerCredential
    ) -> Bool {
        verified.origin.absoluteString == saved.origin &&
        verified.instanceID == saved.serverInstanceID &&
        verified.ownerID == saved.ownerID &&
        verified.username == saved.username &&
        verified.rootNodeID == saved.rootNodeID
    }

    private func humanMessage(_ failure: Error) -> String {
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
        if failure is AuthFailure { return AuthFailure.message(for: failure) }
        return "无法验证当前服务器、账户或云端根目录；未建立原生会话。"
    }

    /// Revalidate the Server Owner and root with an access token obtained
    /// by native login. This is only for future native features, never JS.
    func verifiedAuthorization() async throws ->
        (owner: XDriveNativeOwnerRoot, accessToken: String) {
        guard let snapshot = active else {
            throw XDriveIOSNativeSessionError.notSignedIn
        }
        let ticket = generation
        var token = snapshot.accessToken
        var refresh = snapshot.refreshToken
        let fresh: XDriveNativeOwnerRoot
        do {
            fresh = try await XDriveNativeOwnerRootVerifier(
                origin: snapshot.origin, accessToken: token,
                expectedUsername: snapshot.username
            ).verify()
        } catch XDriveNativeOwnerRootFailure.serverStatus(401) {
            // Foreground schedules can outlive a short-lived access token.
            // Renew ONLY using the isolated native refresh credential and
            // re-prove the exact old Owner/root before any further file I/O.
            let replacement = try await AuthService(origin: snapshot.origin)
                .refresh(token: snapshot.refreshToken)
            try Task.checkCancellation()
            guard generation == ticket,
                  replacement.must_change_password != true,
                  replacement.username == snapshot.username,
                  let newToken = currentAccessToken(replacement),
                  !replacement.refresh_token.isEmpty else {
                throw XDriveIOSNativeSessionError.ownerChanged
            }
            token = newToken
            refresh = replacement.refresh_token
            fresh = try await XDriveNativeOwnerRootVerifier(
                origin: snapshot.origin, accessToken: token,
                expectedUsername: snapshot.username
            ).verify()
        }
        try Task.checkCancellation()
        guard generation == ticket,
              let latest = active,
              latest.refreshToken == snapshot.refreshToken,
              sameScope(fresh, snapshot.verifiedOwner),
              sameScope(latest.verifiedOwner, snapshot.verifiedOwner)
        else { throw XDriveIOSNativeSessionError.staleSession }
        if token != snapshot.accessToken || refresh != snapshot.refreshToken {
            if keepSignedIn {
                try XDriveIOSNativeOwnerSessionStore.save(record(
                    owner: fresh, refreshToken: refresh
                ))
            }
            // A logout/Owner switch cannot interleave with synchronous
            // Keychain save and the following in-memory commit on MainActor.
            active = Session(
                origin: snapshot.origin, username: snapshot.username,
                accessToken: token, refreshToken: refresh,
                verifiedOwner: fresh
            )
            owner = fresh
        }
        return (fresh, token)
    }

    func restore() async {
        guard !restoreAttempted, !busy, active == nil else { return }
        restoreAttempted = true
        busy = true
        generation &+= 1
        let ticket = generation
        defer { busy = false }
        do {
            guard let saved = try XDriveIOSNativeOwnerSessionStore.load()
            else { return }
            let origin = try ServerAddress.parse(saved.origin)
            let refreshed = try await AuthService(origin: origin).refresh(
                token: saved.refreshToken
            )
            try Task.checkCancellation()
            guard generation == ticket,
                  refreshed.must_change_password != true,
                  refreshed.username == saved.username,
                  let accessToken = currentAccessToken(refreshed)
            else { throw XDriveIOSNativeSessionError.ownerChanged }
            let verified = try await XDriveNativeOwnerRootVerifier(
                origin: origin,
                accessToken: accessToken,
                expectedUsername: saved.username
            ).verify()
            try Task.checkCancellation()
            guard generation == ticket,
                  ownerMatchesSaved(verified, saved: saved) else {
                throw XDriveIOSNativeSessionError.ownerChanged
            }
            try XDriveIOSNativeOwnerSessionStore.save(record(
                owner: verified, refreshToken: refreshed.refresh_token
            ))
            guard generation == ticket else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            active = Session(
                origin: origin, username: verified.username,
                accessToken: accessToken, refreshToken: refreshed.refresh_token,
                verifiedOwner: verified
            )
            owner = verified
            serverText = origin.absoluteString
            username = verified.username
            keepSignedIn = true
            noticeMessage = "已恢复并再次验证当前原生账户和云端根目录。"
            errorMessage = nil
        } catch is CancellationError {
            // A cancelled restore cannot resurrect credentials or Owner UI.
        } catch {
            guard generation == ticket else { return }
            if let failure = error as? AuthFailure, case .rejected = failure {
                do {
                    try XDriveIOSNativeOwnerSessionStore.clear()
                } catch {
                    errorMessage = humanMessage(error)
                    return
                }
            }
            errorMessage = humanMessage(error)
        }
    }

    /// Explicit user sign-in, not a PWA Cookie session. A successful HTTP
    /// login alone is insufficient: /me and the Owner root MUST both match.
    func signIn() async {
        guard !busy, active == nil else { return }
        errorMessage = nil
        noticeMessage = nil
        let serverInput = serverText
        let requestedUsername = username.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !requestedUsername.isEmpty, !password.isEmpty else {
            errorMessage = "请填写用户名和密码。"
            return
        }
        busy = true
        generation &+= 1
        let ticket = generation
        defer { busy = false }
        do {
            let origin = try ServerAddress.parse(serverInput)
            let response = try await AuthService(origin: origin).login(
                username: requestedUsername, password: password
            )
            try Task.checkCancellation()
            guard generation == ticket,
                  serverText == serverInput,
                  username.trimmingCharacters(in: .whitespacesAndNewlines) ==
                    requestedUsername else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            password = ""
            guard response.must_change_password != true else {
                throw XDriveIOSNativeSessionError.passwordChangeRequired
            }
            guard response.username == requestedUsername,
                  let accessToken = currentAccessToken(response) else {
                throw XDriveIOSNativeSessionError.ownerChanged
            }
            let verified = try await XDriveNativeOwnerRootVerifier(
                origin: origin,
                accessToken: accessToken,
                expectedUsername: response.username
            ).verify()
            try Task.checkCancellation()
            guard generation == ticket,
                  serverText == serverInput,
                  username == requestedUsername else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            if keepSignedIn {
                try XDriveIOSNativeOwnerSessionStore.save(record(
                    owner: verified, refreshToken: response.refresh_token
                ))
            } else {
                // Do not leave an earlier Owner's remembered credential
                // on disk when the user explicitly selects memory-only login.
                try XDriveIOSNativeOwnerSessionStore.clear()
            }
            guard generation == ticket else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            active = Session(
                origin: origin, username: verified.username,
                accessToken: accessToken, refreshToken: response.refresh_token,
                verifiedOwner: verified
            )
            owner = verified
            serverText = origin.absoluteString
            username = verified.username
            noticeMessage = keepSignedIn
                ? "已在本机安全保存当前 Owner 的保持登录凭据。"
                : "本次仅内存登录，不保留刷新凭据。"
        } catch is CancellationError {
            password = ""
        } catch {
            password = ""
            if generation == ticket { errorMessage = humanMessage(error) }
        }
    }

    /// Invalidate in-memory authority BEFORE any remote request. Failure
    /// removing a persisted credential remains visible and blocks claims
    /// that the local automatic login has been cleared.
    func signOut() async {
        generation &+= 1
        let previous = active
        active = nil
        owner = nil
        password = ""
        noticeMessage = nil
        errorMessage = nil
        do {
            try XDriveIOSNativeOwnerSessionStore.clear()
        } catch {
            errorMessage = humanMessage(error)
            return
        }
        guard let previous else {
            noticeMessage = "本机原生登录凭据已清除。"
            return
        }
        do {
            try await AuthService(origin: previous.origin).logout(
                token: previous.refreshToken
            )
            noticeMessage = "已退出本机原生会话，并得到服务器退出确认。"
        } catch {
            noticeMessage = "本机凭据已清除；服务器会话撤销尚未确认。"
        }
    }
}
