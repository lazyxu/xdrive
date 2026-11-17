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
    private var networkEpoch: UInt64 = 0

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
        let grantOwner = try grant.ownerScope()
        // An OS BGTask can overlap the foreground app. Never replace the
        // foreground route or invalidate its current Owner/Viewer state.
        if let (current, _) = snapshot(), let liveOwner = current.owner {
            guard XDriveIOSAutoRouteSafety.sameOwner(grantOwner, liveOwner),
                  current.logical == logical else {
                throw XDriveIOSPhotoBGVaultFailure.differentOwnerStillApproved
            }
            return (current.domain, current.lan?.host ?? "", current.active)
        }
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
        if let live = binding, let liveOwner = live.owner, live.token != nil {
            let matches = live.logical == owner.origin &&
                XDriveIOSAutoRouteSafety.sameOwner(liveOwner, owner)
            lock.unlock()
            if matches { return }
            throw XDriveIOSPhotoBGVaultFailure.differentOwnerStillApproved
        }
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
           verified.origin == owner.origin, old.token != token {
            binding = Binding(id: UUID(), logical: old.logical, domain: old.domain,
                              lan: old.lan, active: old.active, proven: old.proven,
                              owner: owner, token: token,
                              backgroundGrant: old.backgroundGrant)
        }
        lock.unlock()
        Task { await self.revalidateRoutes() }
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
        // The monitor's first callback can arrive after a successful
        // anonymous LAN probe but before credential/Owner verification.
        // Do not discard that just-proved endpoint if it is the same Wi-Fi.
        let wasUnknown = networkEpoch == 0
        networkEpoch &+= 1
        // A proof of reachability on Wi-Fi A is not a proof for Wi-Fi B.
        // Keep WAN's validated HTTPS identity, but remove LAN's prior network
        // evidence; fresh pinned TLS and exact Owner/Grant proof re-admit it.
        if var current = binding, let lan = current.lan,
           !(wasUnknown && local && current.active == lan) {
            current.proven.remove(lan.absoluteString)
            binding = current
        }
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

    private func snapshotEpoch() -> (Binding, Bool, UInt64)? {
        lock.lock()
        defer { lock.unlock() }
        guard let binding else { return nil }
        return (binding, onLocalNetwork, networkEpoch)
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
        guard let (state, local, epoch) = snapshotEpoch(),
              matching(original, binding: state) else { return nil }
        // Before the Network monitor's first callback, the anonymous TLS
        // selector already proved a LAN candidate. Do not assume cellular.
        let canUseLAN = epoch == 0 ? state.active == state.lan : local
        guard let preferred = XDriveIOSAutoRouteSafety.preferredOrigin(
            domain: state.domain, lan: state.lan,
            proven: state.proven, onLocalNetwork: canUseLAN)
        else { return nil }
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

    /// Keep a separately proven WAN path warm while home Wi-Fi prefers LAN.
    /// The route only gains a proof bit; this never swaps the active LAN route.
    private func warmWANIfNeeded() async {
        guard let (initial, local, epoch) = snapshotEpoch(), local,
              initial.owner != nil, initial.lan != nil,
              !initial.proven.contains(initial.domain.absoluteString),
              await verify(initial.domain, against: initial) else { return }
        lock.lock()
        if var current = binding, current.id == initial.id,
           networkEpoch == epoch, onLocalNetwork {
            current.proven.insert(initial.domain.absoluteString)
            binding = current
        }
        lock.unlock()
    }

    func revalidateRoutes() async {
        guard let (initial, local, epoch) = snapshotEpoch(), initial.owner != nil else { return }
        let candidates: [URL?] = local ? [initial.lan, initial.domain] : [initial.domain]
        for target in candidates.compactMap({ $0 }) {
            // Prefer the FIRST reachable route. Do not verify LAN and then
            // accidentally overwrite it with WAN in the same Wi-Fi pass.
            if target == initial.active, initial.proven.contains(target.absoluteString) {
                if local, target == initial.lan {
                    Task { await self.warmWANIfNeeded() }
                }
                return
            }
            let accepted: Bool
            if initial.proven.contains(target.absoluteString) {
                accepted = true
            } else {
                accepted = await verify(target, against: initial)
            }
            guard accepted else { continue }
            lock.lock()
            // An older Wi-Fi's asynchronous LAN proof must not win after a
            // cellular switch, logout, token rotation or Owner replacement.
            guard var current = binding, current.id == initial.id,
                  onLocalNetwork == local, networkEpoch == epoch else {
                lock.unlock()
                return
            }
            current.proven.insert(target.absoluteString)
            current.active = target
            binding = current
            lock.unlock()
            if local, target == initial.lan {
                Task { await self.warmWANIfNeeded() }
            }
            return
        }
    }

    /// On a network-only failure, verify the alternative before forwarding a
    /// GET/HEAD. Uploads and other writes never retry an uncertain ACK here.
    func recover(failedPhysical: URL, original: URL) async -> URL? {
        guard let (initial, local, epoch) = snapshotEpoch(), initial.owner != nil,
              matching(original, binding: initial) else { return nil }
        let alternative = failedPhysical.host == initial.lan?.host
            ? initial.domain : initial.lan
        // A private-IP destination is not an alternative on cellular data.
        guard let alternative, alternative != initial.lan || local,
              await verify(alternative, against: initial) else { return nil }
        lock.lock()
        // A logout or Owner/token replacement during the proof must not
        // continue an old credential-bearing request at the new physical host.
        guard var current = binding, current.id == initial.id,
              networkEpoch == epoch else {
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
    private var handle: XDriveIOSRoutedSessionPool.Handle?
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
        // Reuse bounded, cookie-free URLSessions across all thumbnail,
        // gallery, file, notes, SSE and upload tasks. A separate pool enforces
        // Wi-Fi-only originals even when the proxy changes physical hosts.
        let next = XDriveIOSRoutedSessionPool.shared.start(
            forwarded, handler: self)
        lock.lock()
        if stopped {
            lock.unlock()
            next.cancel()
            return
        }
        handle = next
        lock.unlock()
    }

    override func stopLoading() {
        lock.lock()
        stopped = true
        let old = handle
        handle = nil
        lock.unlock()
        old?.cancel()
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
        handle = nil
        if let failure, retryCount == 0,
           XDriveIOSAutoRouteSafety.mayReplay(request, after: failure, responseStarted: partial) {
            retryCount = 1
            lock.unlock()
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

}

/// A small shared pool avoids one TLS session per thumbnail or file row.
/// Sessions never keep cookies or Owner credentials; each URLRequest carries
/// its own current authorization, and task callbacks route to one protocol.
private final class XDriveIOSRoutedSessionPool: @unchecked Sendable {
    static let shared = XDriveIOSRoutedSessionPool()

    final class Handle {
        let task: URLSessionDataTask
        private let owner: Delegate
        init(_ task: URLSessionDataTask, owner: Delegate) {
            self.task = task
            self.owner = owner
        }
        func cancel() {
            owner.remove(task.taskIdentifier)
            task.cancel()
        }
    }

    private final class Session {
        let delegate = Delegate()
        let session: URLSession
        init(cellular: Bool) {
            let config = URLSessionConfiguration.ephemeral
            // Do not re-enter the outer routed URLProtocol.
            config.protocolClasses = []
            config.allowsCellularAccess = cellular
            config.httpShouldSetCookies = false
            config.httpCookieAcceptPolicy = .never
            config.urlCache = nil
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            session = URLSession(configuration: config, delegate: delegate,
                                 delegateQueue: nil)
        }
    }

    private let cellular = Session(cellular: true)
    private let wifiOnly = Session(cellular: false)
    private init() {}

    func start(_ request: URLRequest,
               handler: XDriveIOSRoutedURLProtocol) -> Handle {
        let selected = request.allowsCellularAccess ? cellular : wifiOnly
        let task = selected.session.dataTask(with: request)
        selected.delegate.insert(task.taskIdentifier, handler: handler)
        let handle = Handle(task, owner: selected.delegate)
        task.resume()
        return handle
    }

    final class Delegate: XDriveIOSServerTLSDelegate,
                          URLSessionDataDelegate, URLSessionTaskDelegate,
                          @unchecked Sendable {
        private final class WeakHandler {
            weak var value: XDriveIOSRoutedURLProtocol?
            init(_ value: XDriveIOSRoutedURLProtocol) { self.value = value }
        }
        private let lock = NSLock()
        private var handlers: [Int: WeakHandler] = [:]

        func insert(_ id: Int, handler: XDriveIOSRoutedURLProtocol) {
            lock.lock()
            handlers[id] = WeakHandler(handler)
            lock.unlock()
        }
        func remove(_ id: Int) {
            lock.lock()
            handlers.removeValue(forKey: id)
            lock.unlock()
        }
        private func handler(_ id: Int, remove: Bool = false) -> XDriveIOSRoutedURLProtocol? {
            lock.lock()
            let value = handlers[id]?.value
            if remove { handlers.removeValue(forKey: id) }
            lock.unlock()
            return value
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
            handler(dataTask.taskIdentifier)?.receive(response)
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                        didReceive data: Data) {
            handler(dataTask.taskIdentifier)?.receive(data)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        didCompleteWithError error: Error?) {
            handler(task.taskIdentifier, remove: true)?.completed(error)
        }
    }
}
