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
    case localNetworkDenied, connectionTimedOut
    case connectionUnavailable(Int32), domainCertificateInvalid(Int32)
    // Stage-specific IP verification errors. A failed /version response is
    // never evidence that Caddy served the wrong CA or IP SAN.
    case ipCertificateInvalid, ipCertificateIdentityInvalid, ipCertificateChainInvalid
    case ipTLSHandshakeFailed(Int), ipConnectionTimedOut, ipConnectionUnavailable(Int)
    case ipVersionRedirect, ipVersionStatus(Int), ipVersionInvalid

    var message: String {
        switch self {
        case .invalidAuthority: return "请填写有效的 HTTPS 域名和私网 IPv4 地址。"
        case .rootUnavailable: return "内网已连接，但 Caddy 证书下载响应不正确。请检查服务器的内网证书下载入口。"
        case .localNetworkDenied: return "iOS 阻止了本地网络访问。请在设置 → 隐私与安全性 → 本地网络中允许 xDrive，再重试配对。"
        case .connectionTimedOut: return "连接内网 HTTPS 超时。请核对内网 IP、端口和 Wi-Fi；若刚允许本地网络访问，请再点一次配对。"
        case .connectionUnavailable(let code): return "无法建立内网连接（网络错误 \(code)）。请核对 IP、端口和 Wi-Fi 是否可互通。"
        case .domainCertificateInvalid(let code): return "域名 HTTPS 握手或证书校验失败（TLS \(code)）。请检查手机系统时间和服务器域名证书链。"
        case .invalidRoot: return "第 2 步失败：域名 HTTPS 返回的 Caddy 根证书不是有效的单张自签证书。"
        case .ipCertificateInvalid: return "第 3 步失败：内网 IP HTTPS 证书未通过 App 指定 CA 与 IP 身份校验，请检查服务端 Caddy 内网证书。"
        case .ipCertificateIdentityInvalid: return "第 3 步失败：证书链通过指定根 CA 的基础校验，但不符合当前内网 IP 的 SAN 或 TLS 服务器用途。请检查 Caddy 的内网 IP、default_sni 及当前实际连接的设备。"
        case .ipCertificateChainInvalid: return "第 3 步失败：当前内网 HTTPS 的根 CA、证书链、有效期或中间证书校验失败。请检查 Caddy 的内网根证书与当前 IP HTTPS 服务是否为同一套部署。"
        case .ipTLSHandshakeFailed(let code): return "第 3 步失败：内网 HTTPS TLS 握手失败（系统代码 \(code)），尚不能确定是证书问题。请检查 HTTPS 端口、TLS 服务及网络代理。"
        case .ipConnectionTimedOut: return "第 3 步失败：内网 IP HTTPS 探测超时。请检查 Wi-Fi、IP、HTTPS 端口及 iOS 本地网络权限。"
        case .ipConnectionUnavailable(let code): return "第 3 步失败：内网 IP HTTPS 连接异常（系统代码 \(code)）。请检查 IP、端口和网络。"
        case .ipVersionRedirect: return "第 4 步失败：内网版本接口发生 HTTP 跳转；xDrive 不允许在配对时自动跳转到其他入口。"
        case .ipVersionStatus(let status): return "第 4 步失败：内网版本接口返回 HTTP \(status)，而非预期的 200。"
        case .ipVersionInvalid: return "第 4 步失败：内网 /api/v1/version 没有返回有效的 xDrive 版本 JSON；这不一定是证书错误。"
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

/// An independent, read-only diagnostic classification. A basic X.509 check
/// may distinguish IP policy mismatch from a missing/expired/wrong chain, but
/// it NEVER authorizes a connection. Only the full pinned SSL policy does.
enum XDriveIOSLANTrustVerdict: Equatable, Sendable {
    case trusted
    case ipIdentityOrServerUsageMismatch
    case chainOrValidityMismatch
    case trustSetupUnavailable
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

    /// Override only to record a fixed non-secret error category for the
    /// explicitly requested anonymous pairing probe. Never turn it into trust.
    func observedTrustRejection(_ verdict: XDriveIOSLANTrustVerdict) {}

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
        guard challenge.previousFailureCount == 0, let target,
              let trust = space.serverTrust else {
            observedTrustRejection(.trustSetupUnavailable)
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        let verdict = Self.inspect(trust, target: target, rootDER: root)
        guard verdict == .trusted else {
            observedTrustRejection(verdict)
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }

    static func verify(_ trust: SecTrust, target: XDriveIOSLANAuthority, rootDER: Data) -> Bool {
        inspect(trust, target: target, rootDER: rootDER) == .trusted
    }

    static func inspect(_ trust: SecTrust, target: XDriveIOSLANAuthority,
                        rootDER: Data) -> XDriveIOSLANTrustVerdict {
        guard let root = XDriveIOSLANPairing.rootCertificate(rootDER),
              SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, target.ip as CFString)) == errSecSuccess,
              SecTrustSetAnchorCertificates(trust, [root] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess else {
            return .trustSetupUnavailable
        }
        // This is the ONLY positive result allowed by a TLS challenge.
        // It requires the exact user-paired root, leaf validity, full server
        // certificate policy and literal IP SAN, with no network fetch.
        if SecTrustEvaluateWithError(trust, nil) { return .trusted }

        // Negative-result diagnosis only. Basic X.509 explicitly CANNOT
        // authenticate the HTTPS endpoint because it does not check IP SAN
        // or serverAuth EKU. Never return trusted from this path.
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              !chain.isEmpty else { return .chainOrValidityMismatch }
        var secondary: SecTrust?
        guard SecTrustCreateWithCertificates(chain as CFArray,
                  SecPolicyCreateBasicX509(), &secondary) == errSecSuccess,
              let secondary,
              SecTrustSetAnchorCertificates(secondary, [root] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(secondary, true) == errSecSuccess,
              SecTrustSetNetworkFetchAllowed(secondary, false) == errSecSuccess,
              // Preserve an explicit evaluation date, including expired-leaf
              // regressions; a diagnostic may never silently change the time.
              SecTrustSetVerifyDate(secondary, Date(timeIntervalSinceReferenceDate:
                  SecTrustGetVerifyTime(trust)) as CFDate) == errSecSuccess else {
            return .chainOrValidityMismatch
        }
        return SecTrustEvaluateWithError(secondary, nil)
            ? .ipIdentityOrServerUsageMismatch : .chainOrValidityMismatch
    }
}
