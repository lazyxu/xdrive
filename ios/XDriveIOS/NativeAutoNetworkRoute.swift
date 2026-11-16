import Foundation
import Network

/// Transport-only routing. Owner identity and its Keychain scope never change
/// when the phone moves between Wi-Fi and cellular networks.
extension XDriveIOSAutoRouteSafety {
    static func sameOwner(_ lhs: XDriveNativeOwnerRoot,
                          _ rhs: XDriveNativeOwnerRoot) -> Bool {
        sameIdentity(lhsInstance: lhs.instanceID, lhsOwner: lhs.ownerID,
                     lhsUsername: lhs.username, lhsRoot: lhs.rootNodeID,
                     rhsInstance: rhs.instanceID, rhsOwner: rhs.ownerID,
                     rhsUsername: rhs.username, rhsRoot: rhs.rootNodeID)
    }
}

/// Holds the two HTTPS physical routes for one *verified* logical Owner.
/// URLSession clients keep owner.origin unchanged, so SwiftUI tab/Viewer state,
/// Keychain records, Source IDs and photo receipts do not change on a handoff.
final class XDriveIOSAutoRoute: @unchecked Sendable {
    static let shared = XDriveIOSAutoRoute()

    private struct Binding {
        let id: UUID
        let logical: URL
        let domain: URL
        let lan: URL?
        var active: URL
        var proven: Set<String>
        let owner: XDriveNativeOwnerRoot?
        let token: String?
        let backgroundGrant: XDriveIOSApprovedPhotoBGCredential?
    }

    private let lock = NSLock()
    private let monitor = NWPathMonitor()
    private var binding: Binding?
    private var onLocalNetwork = false

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.networkChanged(path.usesInterfaceType(.wifi) ||
                                 path.usesInterfaceType(.wiredEthernet))
        }
        monitor.start(queue: DispatchQueue(label: "com.lazyxu.xdrive.ios.auto-route"))
    }

    /// A route is offered only after strict native TLS/IP pairing exists.
    private func pairedLAN(domain: URL, lanIP: String) -> URL? {
        guard let candidate = try? XDriveIOSNativeLANLoginRoute.candidate(
                origin: domain, ip: lanIP),
              let authority = XDriveIOSLANAuthority(url: candidate),
              let pairing = try? XDriveIOSLANPairingStore.load(authority),
              pairing.domain == XDriveIOSLANPairing.publicDomain(domain)
        else { return nil }
        return candidate
    }

    /// Invoked before restoring a saved refresh token. The caller has already
    /// completed an anonymous, strict-TLS selectOrigin probe. No other route
    /// is authorized until the exact stored Owner/root is re-proven.
    func prepareRestore(logical: URL, domain: URL, lanIP: String, selected: URL) {
        let local = pairedLAN(domain: domain, lanIP: lanIP)
        guard selected == logical || selected == domain || selected == local else { return }
        lock.lock()
        binding = Binding(id: UUID(), logical: logical, domain: domain, lan: local,
                          active: selected, proven: [selected.absoluteString],
                          owner: nil, token: nil, backgroundGrant: nil)
        lock.unlock()
    }

    func activate(owner: XDriveNativeOwnerRoot, token: String,
                  domain: URL, lanIP: String, selected: URL) {
        guard !token.isEmpty else { return }
        let local = pairedLAN(domain: domain, lanIP: lanIP)
        guard selected == owner.origin || selected == domain || selected == local else { return }
        lock.lock()
        binding = Binding(id: UUID(), logical: owner.origin, domain: domain,
                          lan: local, active: selected,
                          proven: [selected.absoluteString], owner: owner,
                          token: token, backgroundGrant: nil)
        lock.unlock()
        Task { await self.revalidateRoutes() }
    }

    /// Background-only route admission. No foreground bearer is present:
    /// the server must independently prove this same Device, Grant, Owner,
    /// Server instance, Root and writable Source on the selected HTTPS route.
    func prepareBackground(_ grant: XDriveIOSApprovedPhotoBGCredential) async throws
        -> (domain: URL, lanIP: String, selected: URL) {
        let logical = try ServerAddress.parse(grant.origin)
        let draft = XDriveIOSNativeLoginDraftStore.load()
        let candidate = try? ServerAddress.parse(draft.server)
        let knownDomain = candidate.flatMap { domain -> URL? in
            if domain == logical { return domain }
            if (try? XDriveIOSNativeLANLoginRoute.candidate(
                origin: domain, ip: draft.lanIP)) == logical { return domain }
            return nil
        }
        let domain = knownDomain ?? logical
        let lanIP = knownDomain == nil ? "" : draft.lanIP
        let selected: URL
        if knownDomain != nil {
            selected = try await XDriveIOSNativeLANLoginRoute.selectOrigin(
                origin: domain, lanIP: lanIP)
        } else {
            selected = logical
        }
        prepareRestore(logical: logical, domain: domain, lanIP: lanIP,
                       selected: selected)
        return (domain, lanIP, selected)
    }

    func activateBackground(grant: XDriveIOSApprovedPhotoBGCredential,
                            domain: URL, lanIP: String, selected: URL) throws {
        let owner = try grant.ownerScope()
        guard grant.matches(owner) else { throw XDriveIOSPhotoBGVaultFailure.corrupt }
        let lan = pairedLAN(domain: domain, lanIP: lanIP)
        guard selected == owner.origin || selected == domain || selected == lan
        else { throw XDriveIOSPhotoBGVaultFailure.corrupt }
        lock.lock()
        binding = Binding(id: UUID(), logical: owner.origin, domain: domain,
                          lan: lan, active: selected,
                          proven: [selected.absoluteString], owner: owner,
                          token: nil, backgroundGrant: grant)
        lock.unlock()
        Task { await self.revalidateRoutes() }
    }

    /// Access token refresh keeps the exact Owner scope and current route.
    func updateToken(owner: XDriveNativeOwnerRoot, token: String) {
        guard !token.isEmpty else { return }
        lock.lock()
        if let old = binding, let verified = old.owner,
           XDriveIOSAutoRouteSafety.sameOwner(verified, owner),
           verified.origin == owner.origin {
            binding = Binding(id: UUID(), logical: old.logical, domain: old.domain,
                              lan: old.lan, active: old.active, proven: old.proven,
                              owner: owner, token: token,
                              backgroundGrant: old.backgroundGrant)
        }
        lock.unlock()
    }

    func clear() {
        lock.lock()
        binding = nil
        lock.unlock()
    }

    func clearBackgroundIfNeeded() {
        lock.lock()
        if binding?.backgroundGrant != nil { binding = nil }
        lock.unlock()
    }

    private func networkChanged(_ local: Bool) {
        lock.lock()
        onLocalNetwork = local
        lock.unlock()
        Task { await self.revalidateRoutes() }
    }

    private func snapshot() -> (Binding, Bool)? {
        lock.lock()
        defer { lock.unlock() }
        guard let binding else { return nil }
        return (binding, onLocalNetwork)
    }

    private static func origin(of url: URL) -> URL? {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }

    private func matching(_ origin: URL, binding: Binding) -> Bool {
        [binding.logical, binding.domain, binding.lan].compactMap { $0 }.contains {
            $0.scheme == origin.scheme && $0.host == origin.host &&
            ($0.port ?? 443) == (origin.port ?? 443)
        }
    }

    func canRoute(_ request: URLRequest) -> Bool {
        guard let requestURL = request.url,
              requestURL.scheme == "https", let pair = snapshot() else { return false }
        return matching(requestURL, binding: pair.0)
    }

    func selectedURL(for original: URL) -> URL? {
        guard let (state, local) = snapshot(), matching(original, binding: state)
        else { return nil }
        let preferred: URL
        if local, let lan = state.lan, state.proven.contains(lan.absoluteString) {
            preferred = lan
        } else if state.proven.contains(state.domain.absoluteString) {
            preferred = state.domain
        } else {
            preferred = state.active
        }
        guard var components = URLComponents(url: original, resolvingAgainstBaseURL: false)
        else { return nil }
        components.scheme = preferred.scheme
        components.host = preferred.host
        components.port = preferred.port
        return components.url
    }

    /// Only an exact current Owner proof authorizes a *new* physical route.
    /// Bypass the routing protocol on these probes; otherwise it could merely
    /// verify the previous route and falsely approve a different address.
    private func verify(_ target: URL, against binding: Binding) async -> Bool {
        guard let owner = binding.owner else { return false }
        // LAN is allowed only when pinned to the configured public domain.
        if target == binding.lan, pairedLAN(
            domain: binding.domain, lanIP: binding.lan?.host ?? "") != target {
            return false
        }
        do {
            if let token = binding.token {
                let proof = try await XDriveNativeOwnerRootVerifier(
                    origin: target, accessToken: token,
                    expectedUsername: owner.username, bypassAutoRoute: true
                ).verify()
                return XDriveIOSAutoRouteSafety.sameOwner(owner, proof)
            }
            if let grant = binding.backgroundGrant {
                let exact = try await XDriveIOSApprovedPhotoBGVault.prove(
                    grant, at: target, direct: true)
                return exact.matches(owner)
            }
        } catch {
            return false
        }
        return false
    }

    func revalidateRoutes() async {
        guard let (initial, local) = snapshot(), initial.owner != nil else { return }
        let candidates = local ? [initial.lan, initial.domain] : [initial.domain, initial.lan]
        for target in candidates.compactMap({ $0 }) {
            guard target != initial.active || !initial.proven.contains(target.absoluteString)
            else { continue }
            if await verify(target, against: initial) {
                lock.lock()
                if var current = binding, current.id == initial.id {
                    current.proven.insert(target.absoluteString)
                    current.active = target
                    binding = current
                }
                lock.unlock()
            }
        }
    }

    /// On a network-only failure, verify the alternative before forwarding a
    /// GET/HEAD. Uploads and other writes never retry an uncertain ACK here.
    func recover(failedPhysical: URL, original: URL) async -> URL? {
        guard let (initial, _) = snapshot(), initial.owner != nil,
              matching(original, binding: initial) else { return nil }
        let alternative = failedPhysical.host == initial.lan?.host
            ? initial.domain : initial.lan
        guard let alternative, await verify(alternative, against: initial) else { return nil }
        lock.lock()
        // A logout or Owner/token replacement during the proof must not
        // continue an old credential-bearing request at the new physical host.
        guard var current = binding, current.id == initial.id else {
            lock.unlock()
            return nil
        }
        current.active = alternative
        // Proven routes are origin URLs, not full request endpoints.
        if let failedOrigin = Self.origin(of: failedPhysical) {
            current.proven.remove(failedOrigin.absoluteString)
        }
        current.proven.insert(alternative.absoluteString)
        binding = current
        lock.unlock()
        guard var components = URLComponents(url: original, resolvingAgainstBaseURL: false)
        else { return nil }
        components.host = alternative.host
        components.port = alternative.port
        return components.url
    }

    /// Every native URLSession that touches the xDrive Server opts into this
    /// protocol; private iCloud/PhotoKit connections remain outside its scope.
    static func ephemeralConfiguration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [XDriveIOSRoutedURLProtocol.self] + (config.protocolClasses ?? [])
        return config
    }
}

/// Transparent per-request transport shim. It never changes Owner identity or
/// sends credentials to an unverified endpoint. It preserves stream chunks for
/// SSE and refuses all HTTP redirects under the existing strict TLS delegate.
final class XDriveIOSRoutedURLProtocol: URLProtocol, @unchecked Sendable {
    private let lock = NSLock()
    private var stopped = false
    private var responseStarted = false
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var delegate: RoutedDelegate?
    private var retryCount = 0
    private var physicalURL: URL?

    override class func canInit(with request: URLRequest) -> Bool {
        XDriveIOSAutoRoute.shared.canRoute(request)
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let original = request.url,
              let physical = XDriveIOSAutoRoute.shared.selectedURL(for: original) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        begin(physical)
    }

    private func begin(_ target: URL) {
        lock.lock()
        if stopped { lock.unlock(); return }
        physicalURL = target
        responseStarted = false
        lock.unlock()

        var forwarded = request
        forwarded.url = target
        forwarded.httpShouldHandleCookies = false
        let config = URLSessionConfiguration.ephemeral
        // Never recursively intercept a transport already routed here.
        config.protocolClasses = []
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.allowsCellularAccess = request.allowsCellularAccess
        let nextDelegate = RoutedDelegate(protocolHandler: self)
        let nextSession = URLSession(configuration: config,
                                     delegate: nextDelegate, delegateQueue: nil)
        let nextTask = nextSession.dataTask(with: forwarded)
        lock.lock()
        if stopped {
            lock.unlock()
            nextSession.invalidateAndCancel()
            return
        }
        delegate = nextDelegate
        session = nextSession
        task = nextTask
        lock.unlock()
        nextTask.resume()
    }

    override func stopLoading() {
        lock.lock()
        stopped = true
        let old = session
        session = nil
        task = nil
        delegate = nil
        lock.unlock()
        old?.invalidateAndCancel()
    }

    fileprivate func receive(_ response: URLResponse) {
        lock.lock()
        let active = !stopped
        responseStarted = true
        lock.unlock()
        guard active else { return }
        // Preserve the logical request URL in the response exposed to readers.
        if let http = response as? HTTPURLResponse, let original = request.url {
            var headers: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                if let key = key as? String { headers[key] = String(describing: value) }
            }
            if let mapped = HTTPURLResponse(url: original, statusCode: http.statusCode,
                                            httpVersion: nil, headerFields: headers) {
                client?.urlProtocol(self, didReceive: mapped, cacheStoragePolicy: .notAllowed)
                return
            }
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    }

    fileprivate func receive(_ bytes: Data) {
        lock.lock()
        let active = !stopped
        responseStarted = true
        lock.unlock()
        if active { client?.urlProtocol(self, didLoad: bytes) }
    }

    fileprivate func completed(_ failure: Error?) {
        lock.lock()
        let active = !stopped
        let partial = responseStarted
        let currentURL = physicalURL
        let oldSession = session
        session = nil
        task = nil
        delegate = nil
        if let failure, retryCount == 0,
           XDriveIOSAutoRouteSafety.mayReplay(request, after: failure, responseStarted: partial) {
            retryCount = 1
            lock.unlock()
            oldSession?.finishTasksAndInvalidate()
            guard active, let original = request.url, let currentURL else { return }
            Task { [weak self] in
                guard let self else { return }
                if let other = await XDriveIOSAutoRoute.shared.recover(
                    failedPhysical: currentURL, original: original
                ) {
                    self.begin(other)
                } else {
                    self.fail(failure)
                }
            }
            return
        }
        lock.unlock()
        oldSession?.finishTasksAndInvalidate()
        guard active else { return }
        if let failure {
            // A write or a partial SSE must receive its original failure:
            // schedule a new, independently-proved route for future requests,
            // but never replay its unknown Server ACK or already-seen frames.
            if XDriveIOSAutoRouteSafety.isNetworkFailure(failure),
               let original = request.url, let currentURL {
                Task {
                    _ = await XDriveIOSAutoRoute.shared.recover(
                        failedPhysical: currentURL, original: original)
                }
            }
            fail(failure)
        } else {
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    private func fail(_ error: Error) {
        lock.lock()
        let active = !stopped
        lock.unlock()
        if active { client?.urlProtocol(self, didFailWithError: error) }
    }

    private final class RoutedDelegate: XDriveIOSServerTLSDelegate,
                                        URLSessionDataDelegate, URLSessionTaskDelegate,
                                        @unchecked Sendable {
        private weak var handler: XDriveIOSRoutedURLProtocol?

        init(protocolHandler: XDriveIOSRoutedURLProtocol) {
            handler = protocolHandler
            super.init()
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                        didReceive response: URLResponse,
                        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            handler?.receive(response)
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                        didReceive data: Data) {
            handler?.receive(data)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        didCompleteWithError error: Error?) {
            handler?.completed(error)
        }
    }
}
