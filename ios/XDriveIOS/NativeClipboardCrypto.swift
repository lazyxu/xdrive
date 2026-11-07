import CommonCrypto
import CryptoKit
import Foundation

// Same Web/PWA AES-GCM v1 wire contract: 310k PBKDF2/HMAC-SHA256,
// 256-bit AES, 96-bit nonce, ciphertext||16-byte tag and exact UTF-8 AAD.
enum XDriveIOSClipboardCrypto {
    static let checkEventID = "00000000-0000-4000-8000-000000000001"
    static let checkText = "xDrive Clipboard Vault v1"
    static let maxTextBytes = 65_536

    enum Failure: LocalizedError {
        case invalidKey, invalidMessage, invalidCiphertext, invalidOwner, wrongPassword, http(Int)
        var errorDescription: String? {
            switch self {
            case .invalidKey: return "剪贴板口令或加密参数无效。"
            case .invalidMessage: return "剪贴板文本必须在 1–65536 字节之间。"
            case .invalidCiphertext: return "剪贴板密文格式或验证失败。"
            case .invalidOwner: return "当前账号或服务器已变化，请重新登录。"
            case .wrongPassword: return "剪贴板口令不正确，或加密数据已损坏。"
            case .http(let code): return "剪贴板服务器请求失败（HTTP \(code)）。"
            }
        }
    }

    struct Encrypted: Encodable {
        let client_event_id: String
        let kind: String
        let nonce: String
        let ciphertext: String
    }

    static func key(_ password: String, salt: String) throws -> SymmetricKey {
        guard password.utf16.count >= 12 && password.utf16.count <= 256,
              let saltBytes = Data(base64Encoded: salt),
              saltBytes.count == 16 else { throw Failure.invalidKey }
        var output = [UInt8](repeating: 0, count: 32)
        // Read this before withUnsafeMutableBufferPointer to satisfy Swift's
        // exclusive access rules and keep CommonCrypto's 256-bit output fixed.
        let derivedCount = output.count
        let utf8 = Array(password.utf8CString)
        let status = utf8.withUnsafeBufferPointer { pass in
            saltBytes.withUnsafeBytes { rawSalt in
                output.withUnsafeMutableBufferPointer { derived in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                        pass.baseAddress, utf8.count - 1,
                        rawSalt.bindMemory(to: UInt8.self).baseAddress, saltBytes.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 310_000,
                        derived.baseAddress, derivedCount)
                }
            }
        }
        guard status == kCCSuccess else { throw Failure.invalidKey }
        return SymmetricKey(data: Data(output))
    }

    static func kind(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.range(of: #"^https?://\S+$"#, options: .regularExpression) != nil
            ? "text/uri-list" : "text/plain"
    }
    private static func aad(_ scope: String, _ eventID: String, _ kind: String) -> Data {
        Data("xdrive-clipboard-v1|\(scope)|\(eventID)|\(kind)".utf8)
    }
    static func encrypt(_ text: String, key: SymmetricKey, scope: String,
                        eventID: String = UUID().uuidString.lowercased()) throws -> Encrypted {
        let plain = Data(text.utf8)
        guard !plain.isEmpty && plain.count <= maxTextBytes,
              UUID(uuidString: eventID) != nil else { throw Failure.invalidMessage }
        let mediaKind = kind(text)
        let nonce = AES.GCM.Nonce()
        let box = try AES.GCM.seal(plain, using: key, nonce: nonce,
                               authenticating: aad(scope, eventID, mediaKind))
        return Encrypted(client_event_id: eventID, kind: mediaKind,
                         nonce: Data(nonce).base64EncodedString(),
                         ciphertext: (box.ciphertext + box.tag).base64EncodedString())
    }
    static func decrypt(_ wire: Encrypted, key: SymmetricKey, scope: String) throws -> String {
        guard UUID(uuidString: wire.client_event_id) != nil,
              wire.kind == "text/plain" || wire.kind == "text/uri-list",
              let iv = Data(base64Encoded: wire.nonce), iv.count == 12,
              let encrypted = Data(base64Encoded: wire.ciphertext),
              encrypted.count >= 17 && encrypted.count <= maxTextBytes + 16
        else { throw Failure.invalidCiphertext }
        let nonce = try AES.GCM.Nonce(data: iv)
        let tag = encrypted.suffix(16)
        let body = encrypted.dropLast(16)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: body, tag: tag)
        let plain = try AES.GCM.open(box, using: key,
                                     authenticating: aad(scope, wire.client_event_id, wire.kind))
        guard !plain.isEmpty && plain.count <= maxTextBytes,
              let text = String(data: plain, encoding: .utf8) else {
            throw Failure.invalidCiphertext
        }
        return text
    }
    static func check(key: SymmetricKey, scope: String) throws -> Encrypted {
        try encrypt(checkText, key: key, scope: scope, eventID: checkEventID)
    }
    static func verify(key: SymmetricKey, scope: String,
                       nonce: String, ciphertext: String) throws {
        let check = Encrypted(client_event_id: checkEventID,
                              kind: "text/plain", nonce: nonce, ciphertext: ciphertext)
        guard (try? decrypt(check, key: key, scope: scope)) == checkText else {
            throw Failure.wrongPassword
        }
    }
}
