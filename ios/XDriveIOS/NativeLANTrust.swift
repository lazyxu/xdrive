import CryptoKit
import Foundation
import Security

/// An App trust anchor can only be selected for one RFC1918 HTTPS authority.
struct XDriveIOSLANAuthority: Equatable, Sendable {
    let ip: String
    let port: Int

    init?(ip: String, port: Int) {
        let fields = ip.split(separator: ".", omittingEmptySubsequences: false)
        let octets = fields.compactMap { field -> UInt8? in
            guard (1...3).contains(field.utf8.count),
                  field.utf8.allSatisfy({ (48...57).contains($0) }),
                  field.count == 1 || field.first != "0" else { return nil }
            return UInt8(field)
        }
        guard fields.count == 4, octets.count == 4, (1...65535).contains(port),
              octets[0] == 10 || (octets[0] == 172 && (16...31).contains(octets[1])) ||
                (octets[0] == 192 && octets[1] == 168) else { return nil }
        self.ip = ip
        self.port = port
    }

    init?(url: URL) {
        guard url.scheme == "https", let host = url.host else { return nil }
        self.init(ip: host, port: url.port ?? 443)
    }

    var keychainAccount: String { "\(ip):\(port)" }
}

enum XDriveIOSLANPairingFailure: Error {
    case invalidAuthority, rootUnavailable, invalidRoot, differentDomain, keychain

    var message: String {
        switch self {
        case .invalidAuthority: return "请填写有效的 HTTPS 域名和私网 IPv4 地址。"
        case .rootUnavailable: return "无法通过内网读取 Caddy 证书。请检查内网 IP 和端口是否可达，以及 Caddy 的域名证书。"
        case .invalidRoot: return "域名提供的证书无法验证该内网地址。请核对 Caddy 的 IP 和证书。"
        case .differentDomain: return "该内网地址已绑定另一个 HTTPS 域名。请使用原域名或为新服务器配置不同的内网入口。"
        case .keychain: return "无法读取或保存内网证书配对，请解锁设备后重试。"
        }
    }
}

struct XDriveIOSLANPairing: Codable, Sendable {
    let domain: String
    let rootDER: Data

    var fingerprint: String { SHA256.hash(data: rootDER).map { String(format: "%02x", $0) }.joined() }

    static func publicDomain(_ url: URL) -> String? {
        guard url.scheme == "https", let host = url.host?.lowercased(),
              host.utf8.count <= 253, host.contains("."),
              !host.hasSuffix(".local"),
              !host.utf8.allSatisfy({ $0 == 46 || (48...57).contains($0) }),
              url.user == nil, url.password == nil, url.query == nil,
              url.fragment == nil, url.path.isEmpty || url.path == "/" else { return nil }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.allSatisfy({ label in
            (1...63).contains(label.utf8.count) && label.first != "-" && label.last != "-" &&
                label.utf8.allSatisfy { $0 == 45 || (48...57).contains($0) || (97...122).contains($0) }
        }), (1...65535).contains(url.port ?? 443) else { return nil }
        return "https://\(host):\(url.port ?? 443)"
    }

    static func rootDER(from data: Data) -> Data? {
        guard (256...8192).contains(data.count),
              let pem = String(data: data, encoding: .ascii) else { return nil }
        var lines = pem.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        if lines.last == "" { lines.removeLast() }
        guard lines.count >= 3, lines.first == "-----BEGIN CERTIFICATE-----",
              lines.last == "-----END CERTIFICATE-----",
              let der = Data(base64Encoded: lines.dropFirst().dropLast().joined()),
              rootCertificate(der) != nil else { return nil }
        return der
    }

    static func rootCertificate(_ der: Data) -> SecCertificate? {
        guard (256...8192).contains(der.count),
              let cert = SecCertificateCreateWithData(nil, der as CFData),
              SecCertificateCopyData(cert) as Data == der,
              let issuer = SecCertificateCopyNormalizedIssuerSequence(cert),
              let subject = SecCertificateCopyNormalizedSubjectSequence(cert),
              (issuer as Data) == (subject as Data) else { return nil }
        return cert
    }
}

/// Keychain sharing and synchronization are disabled. The same Device-only
/// anchor is available to the app's PhotoKit BGProcessing task after unlock.
enum XDriveIOSLANPairingStore {
    private static func query(_ target: XDriveIOSLANAuthority) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.lazyxu.xdrive.ios.lan-https.v1",
         kSecAttrAccount as String: target.keychainAccount,
         kSecAttrSynchronizable as String: false]
    }

    static func load(_ target: XDriveIOSLANAuthority) throws -> XDriveIOSLANPairing? {
        var params = query(target)
        params[kSecMatchLimit as String] = kSecMatchLimitOne
        params[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(params as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count <= 16_384,
              let item = try? JSONDecoder().decode(XDriveIOSLANPairing.self, from: data),
              let domainURL = URL(string: item.domain), XDriveIOSLANPairing.publicDomain(domainURL) == item.domain,
              (domainURL.port ?? 443) == target.port,
              XDriveIOSLANPairing.rootCertificate(item.rootDER) != nil else {
            throw XDriveIOSLANPairingFailure.keychain
        }
        return item
    }

    /// Only the explicitly requested pairing flow may replace a CA. The same
    /// authenticated DNS origin must authorize a rotation for this authority.
    @MainActor static func save(_ item: XDriveIOSLANPairing, for target: XDriveIOSLANAuthority) throws {
        let data = try JSONEncoder().encode(item)
        if let old = try load(target) {
            guard old.domain == item.domain else { throw XDriveIOSLANPairingFailure.differentDomain }
            if old.rootDER == item.rootDER { return }
            let status = SecItemUpdate(query(target) as CFDictionary,
                                       [kSecValueData as String: data] as CFDictionary)
            guard status == errSecSuccess else { throw XDriveIOSLANPairingFailure.keychain }
            return
        }
        var params = query(target)
        params[kSecValueData as String] = data
        params[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(params as CFDictionary, nil) == errSecSuccess else {
            throw XDriveIOSLANPairingFailure.keychain
        }
    }
}

/// Existing transports keep their request and redirect policies. Only the
/// server-trust challenge is shared, including foreground and BGProcessing.
class XDriveIOSServerTLSDelegate: NSObject, URLSessionDelegate, @unchecked Sendable {
    enum TrustMode: Sendable {
        case storedPairings
        case verifyingPairing(XDriveIOSLANAuthority, Data)
    }

    private let mode: TrustMode

    init(mode: TrustMode = .storedPairings) {
        self.mode = mode
        super.init()
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        let target = space.protocol == "https"
            ? XDriveIOSLANAuthority(ip: space.host, port: space.port == 0 ? 443 : space.port) : nil
        let root: Data
        switch mode {
        case .storedPairings:
            do {
                guard let target, let pairing = try XDriveIOSLANPairingStore.load(target) else {
                    completionHandler(.performDefaultHandling, nil)
                    return
                }
                root = pairing.rootDER
            } catch {
                completionHandler(.cancelAuthenticationChallenge, nil)
                return
            }
        case let .verifyingPairing(expected, der):
            guard target == expected else {
                completionHandler(.cancelAuthenticationChallenge, nil)
                return
            }
            root = der
        }
        guard challenge.previousFailureCount == 0, let target, let trust = space.serverTrust,
              Self.verify(trust, target: target, rootDER: root) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }

    static func verify(_ trust: SecTrust, target: XDriveIOSLANAuthority, rootDER: Data) -> Bool {
        guard let root = XDriveIOSLANPairing.rootCertificate(rootDER),
              SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, target.ip as CFString)) == errSecSuccess,
              SecTrustSetAnchorCertificates(trust, [root] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess,
              SecTrustEvaluateWithError(trust, nil),
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              chain.count >= 2, let anchor = chain.last else { return false }
        return SecCertificateCopyData(anchor) as Data == rootDER
    }
}
