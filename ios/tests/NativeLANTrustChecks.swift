import Foundation
import Security

@main
enum NativeLANTrustChecks {
    static func main() throws {
        let fixtures = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let ip = XDriveIOSLANAuthority(ip: "192.168.2.4", port: 8443)!
        let otherIP = XDriveIOSLANAuthority(ip: "192.168.2.5", port: 8443)!
        precondition(ip != XDriveIOSLANAuthority(ip: "192.168.2.4", port: 443))
        precondition(XDriveIOSLANAuthority(ip: "127.0.0.1", port: 8443) == nil)
        precondition(XDriveIOSLANAuthority(ip: "192.168.002.4", port: 8443) == nil)
        precondition(XDriveIOSLANAuthority(ip: "192.168.2.4", port: 0) == nil)
        precondition(XDriveIOSLANPairing.publicDomain(URL(string: "https://drive.example.com:8443")!) ==
                     "https://drive.example.com:8443")
        for url in ["http://drive.example.com", "https://192.168.2.4", "https://u@drive.example.com",
                    "https://drive.example.com/path", "https://drive.example.com/?target=192.168.2.4"] {
            precondition(XDriveIOSLANPairing.publicDomain(URL(string: url)!) == nil, url)
        }

        let pem = try Data(contentsOf: fixtures.appendingPathComponent("ca.pem"))
        try checkBootstrapFraming(pem)
        let root = XDriveIOSLANPairing.rootDER(from: pem)!
        let otherRoot = XDriveIOSLANPairing.rootDER(from: try Data(contentsOf: fixtures.appendingPathComponent("other-ca.pem")))!
        precondition(XDriveIOSLANPairing.rootDER(from: pem + pem) == nil, "reject concatenated PEM")
        precondition(XDriveIOSLANPairing.rootDER(from: Data(repeating: 65, count: 8193)) == nil)
        let publicRoot = SecCertificateCreateWithData(nil, root as CFData)!

        func trust(_ name: String) throws -> SecTrust {
            let der = try Data(contentsOf: fixtures.appendingPathComponent(name + ".der"))
            let leaf = SecCertificateCreateWithData(nil, der as CFData)!
            var result: SecTrust?
            precondition(SecTrustCreateWithCertificates([leaf, publicRoot] as CFArray,
                                                         SecPolicyCreateBasicX509(), &result) == errSecSuccess)
            return result!
        }

        let valid = try trust("ip")
        precondition(XDriveIOSServerTLSDelegate.verify(valid, target: ip, rootDER: root), "correct CA and IP SAN")
        let wrongIP = try trust("ip")
        precondition(!XDriveIOSServerTLSDelegate.verify(wrongIP, target: otherIP, rootDER: root), "reject wrong IP")
        let dnsOnly = try trust("dns")
        precondition(!XDriveIOSServerTLSDelegate.verify(dnsOnly, target: ip, rootDER: root), "reject DNS SAN as IP")
        let wrongRoot = try trust("ip")
        precondition(!XDriveIOSServerTLSDelegate.verify(wrongRoot, target: ip, rootDER: otherRoot), "reject wrong CA")
        let expired = try trust("ip")
        precondition(SecTrustSetVerifyDate(expired, Date(timeIntervalSinceNow: 14 * 86_400) as CFDate) == errSecSuccess)
        precondition(!XDriveIOSServerTLSDelegate.verify(expired, target: ip, rootDER: root), "reject expired leaf")
        let leafPEM = try Data(contentsOf: fixtures.appendingPathComponent("ip.pem"))
        precondition(XDriveIOSLANPairing.rootDER(from: leafPEM) == nil, "reject leaf as the root")
        print("Native LAN certificate policy checks passed")
    }

    private static func checkBootstrapFraming(_ pem: Data) throws {
        let header = "HTTP/1.0 200 OK\r\nContent-Type: application/x-pem-file\r\nContent-Length: \(pem.count)\r\n"
        let partial = try XDriveIOSLANCertificateBootstrap.certificate(in: Data(header.utf8))
        precondition(partial == nil)
        let response = Data((header + "\r\n").utf8) + pem
        let incomplete = try XDriveIOSLANCertificateBootstrap.certificate(in: response.dropLast())
        precondition(incomplete == nil)
        let complete = try XDriveIOSLANCertificateBootstrap.certificate(in: response)
        precondition(complete == pem)
        for invalid in [header.replacingOccurrences(of: "200 OK", with: "302 Found"),
                        header + "Content-Length: \(pem.count)\r\n",
                        header + "Transfer-Encoding: chunked\r\n",
                        header.replacingOccurrences(of: "application/x-pem-file", with: "text/html"),
                        header.replacingOccurrences(of: "\(pem.count)", with: "99999")] {
            do {
                _ = try XDriveIOSLANCertificateBootstrap.certificate(in: Data((invalid + "\r\n").utf8) + pem)
                preconditionFailure("accepted invalid bootstrap response")
            } catch XDriveIOSLANPairingFailure.rootUnavailable { continue }
        }
    }
}
