import Foundation
import Network
import Security

/// Dial only the selected private IPv4. Authenticate the configured DNS name
/// with system trust and SNI, just as a normal connection to that name would.
/// This deliberately supports one public, credential-free Caddy GET.
enum XDriveIOSLANCertificateBootstrap {
    static let maximumHeader = 4096
    static let maximumCertificate = 8192
    private static let delimiter = Data("\r\n\r\n".utf8)

    /// Fixed categories and numeric OS codes only: never expose an underlying
    /// error's URL, request headers, credentials or arbitrary description.
    static func transportFailure(_ error: NWError?, localNetworkDenied: Bool = false) -> XDriveIOSLANPairingFailure {
        if localNetworkDenied { return .localNetworkDenied }
        guard let error else { return .connectionTimedOut }
        switch error {
        case .tls(let status): return .domainCertificateInvalid(status)
        case .posix(.ETIMEDOUT): return .connectionTimedOut
        case .posix(let code): return .connectionUnavailable(code.rawValue)
        case .dns(let code):
            // kDNSServiceErr_PolicyDenied, also used by local network privacy.
            return code == -65570 ? .localNetworkDenied : .connectionUnavailable(code)
        @unknown default: return .connectionUnavailable(0)
        }
    }

    static func fetch(origin: URL, target: XDriveIOSLANAuthority) async throws -> Data {
        guard XDriveIOSLANPairing.publicDomain(origin) != nil, let host = origin.host,
              (origin.port ?? 443) == target.port, let address = IPv4Address(target.ip),
              let port = NWEndpoint.Port(rawValue: UInt16(target.port)) else {
            throw XDriveIOSLANPairingFailure.invalidAuthority
        }
        let request = Request(host: host, address: address, port: port)
        return try await request.fetch()
    }

    /// Caddy's static file route supplies a Content-Length. Reject redirects,
    /// ambiguous framing and encodings instead of interpreting arbitrary HTTP.
    static func certificate(in buffer: Data) throws -> Data? {
        let fail = XDriveIOSLANPairingFailure.rootUnavailable
        guard buffer.count <= maximumHeader + maximumCertificate else { throw fail }
        guard let boundary = buffer.range(of: delimiter) else {
            if buffer.count >= maximumHeader { throw fail }
            return nil
        }
        guard boundary.upperBound <= maximumHeader,
              let header = String(data: buffer[..<boundary.lowerBound], encoding: .ascii) else { throw fail }
        let lines = header.components(separatedBy: "\r\n")
        guard let status = lines.first,
              status.hasPrefix("HTTP/1.0 200 ") || status.hasPrefix("HTTP/1.1 200 ") else { throw fail }
        var length: Int?
        var validType = false
        var encoded = false
        for line in lines.dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, !parts[0].isEmpty,
                  parts[0].utf8.allSatisfy({ $0 > 32 && $0 < 127 }) else { throw fail }
            let value = parts[1].trimmingCharacters(in: .whitespaces)
            switch parts[0].lowercased() {
            case "content-length":
                guard length == nil, !value.isEmpty, value.utf8.allSatisfy({ (48...57).contains($0) }),
                      let count = Int(value), (256...maximumCertificate).contains(count) else { throw fail }
                length = count
            case "content-type":
                guard !validType, value.lowercased() == "application/x-pem-file" else { throw fail }
                validType = true
            case "transfer-encoding":
                throw fail
            case "content-encoding":
                guard !encoded, value.lowercased() == "identity" else { throw fail }
                encoded = true
            default:
                break
            }
        }
        guard validType, let length else { throw fail }
        let body = buffer[boundary.upperBound...]
        guard body.count <= length else { throw fail }
        return body.count == length ? Data(body) : nil
    }

    private final class Request: @unchecked Sendable {
        private let queue = DispatchQueue(label: "com.lazyxu.xdrive.ios.lan-certificate-bootstrap")
        private let connection: NWConnection
        private let request: Data
        // All mutable state is confined to queue, including cancellation.
        private var pending: CheckedContinuation<Data, Error>?
        private var cancelled = false
        private var sent = false
        private var response = Data()
        private var waitingError: NWError?

        init(host: String, address: IPv4Address, port: NWEndpoint.Port) {
            let tls = NWProtocolTLS.Options()
            let options = tls.securityProtocolOptions
            sec_protocol_options_set_min_tls_protocol_version(options, .TLSv12)
            sec_protocol_options_set_tls_server_name(options, host)
            sec_protocol_options_set_verify_block(options, { _, trust, complete in
                let evaluation = sec_trust_copy_ref(trust).takeRetainedValue()
                let matched = SecTrustSetPolicies(evaluation, SecPolicyCreateSSL(true, host as CFString)) == errSecSuccess &&
                    SecTrustEvaluateWithError(evaluation, nil)
                complete(matched)
            }, queue)
            let parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
            connection = NWConnection(host: .ipv4(address), port: port, using: parameters)
            request = Data(("GET /_xdrive/desktop/lan-root.crt HTTP/1.0\r\n" +
                "Host: \(host):\(port.rawValue)\r\nAccept: application/x-pem-file\r\n" +
                "Cache-Control: no-store\r\nConnection: close\r\n\r\n").utf8)
        }

        func fetch() async throws -> Data {
            try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    queue.async {
                        guard !self.cancelled else {
                            continuation.resume(throwing: CancellationError())
                            return
                        }
                        self.pending = continuation
                        self.connection.stateUpdateHandler = { [weak self] state in self?.observe(state) }
                        self.connection.start(queue: self.queue)
                        self.queue.asyncAfter(deadline: .now() + 8) { [weak self] in
                            guard let self else { return }
                            self.finish(.failure(XDriveIOSLANCertificateBootstrap.transportFailure(
                                self.waitingError,
                                localNetworkDenied: self.connection.currentPath?.unsatisfiedReason == .localNetworkDenied
                            )))
                        }
                    }
                }
            } onCancel: {
                queue.async {
                    self.cancelled = true
                    self.finish(.failure(CancellationError()))
                }
            }
        }

        private func observe(_ state: NWConnection.State) {
            switch state {
            case .waiting(let error):
                // Keep the same connection while the user answers iOS's first
                // permission prompt; do not misreport it as a bad certificate.
                waitingError = error
            case .preparing:
                waitingError = nil
            case .ready where !sent:
                waitingError = nil
                sent = true
                connection.send(content: request, completion: .contentProcessed { [weak self] error in
                    if let error { self?.finish(.failure(XDriveIOSLANCertificateBootstrap.transportFailure(error))) }
                    else { self?.receive() }
                })
            case .failed(let error):
                finish(.failure(XDriveIOSLANCertificateBootstrap.transportFailure(
                    error, localNetworkDenied: connection.currentPath?.unsatisfiedReason == .localNetworkDenied
                )))
            case .cancelled: finish(.failure(CancellationError()))
            default: break
            }
        }

        private func receive() {
            guard pending != nil else { return }
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, ended, error in
                guard let self, self.pending != nil else { return }
                do {
                    if let error { throw XDriveIOSLANCertificateBootstrap.transportFailure(error) }
                    if let data { self.response.append(data) }
                    if let pem = try XDriveIOSLANCertificateBootstrap.certificate(in: self.response) {
                        self.finish(.success(pem))
                    } else if ended {
                        self.finish(.failure(XDriveIOSLANPairingFailure.rootUnavailable))
                    } else {
                        self.receive()
                    }
                } catch { self.finish(.failure(error)) }
            }
        }

        private func finish(_ result: Result<Data, Error>) {
            guard let continuation = pending else { return }
            pending = nil
            connection.stateUpdateHandler = nil
            connection.cancel()
            continuation.resume(with: result)
        }
    }
}
