import CryptoKit
import Foundation

// Executable production-CryptoKit interoperability contract. The same
// non-secret test fixture is consumed by WebCrypto/Node and Android JVM.
private struct ClipboardFixture: Decodable {
    struct Entry: Decodable {
        let client_event_id: String
        let kind: String
        let nonce: String
        let ciphertext: String
        let plaintext: String
    }
    struct Check: Decodable {
        let nonce: String
        let ciphertext: String
    }
    let protocolName: String
    let kdf: String
    let iterations: Int
    let salt: String
    let passphrase: String
    let aad_scope: String
    let owner_id: UInt64
    let key_hex: String
    let items: [Entry]
    let vault_check: Check

    enum CodingKeys: String, CodingKey {
        case protocolName = "protocol"
        case kdf, iterations, salt, passphrase, aad_scope, owner_id,
             key_hex, items, vault_check
    }
}

private struct UnicodeClipboardFixture: Decodable {
    let schema_version: Int
    let passphrase: String
    let salt: String
    let iterations: Int
    let owner_scope: String
    let client_event_id: String
    let kind: String
    let nonce: String
    let ciphertext: String
    let plaintext: String
    let derived_key_hex: String
}

@main
struct NativeClipboardCryptoChecks {
    static func expect(_ value: @autoclosure () throws -> Bool, _ detail: String) throws {
        guard try value() else { throw NSError(domain: "ClipboardV1Interop", code: 1,
                                            userInfo: [NSLocalizedDescriptionKey: detail]) }
    }

    static func keyHex(_ key: SymmetricKey) -> String {
        key.withUnsafeBytes { Data($0) }.map { String(format: "%02x", $0) }.joined()
    }

    static func main() throws {
        let fixtureBytes = try Data(contentsOf: URL(
            fileURLWithPath: "tests/fixtures/clipboard-v1-interoperability.json"))
        let fixture = try JSONDecoder().decode(ClipboardFixture.self, from: fixtureBytes)
        try expect(fixture.protocolName == "xdrive-clipboard-v1", "Wrong protocol version")
        try expect(fixture.kdf == "PBKDF2-SHA256" && fixture.iterations == 310000,
                   "Unexpected KDF downgrade")
        try expect(fixture.aad_scope == "https://clipboard.example.test:\(fixture.owner_id)",
                   "Noncanonical Owner AAD")
        let key = try XDriveIOSClipboardCrypto.key(fixture.passphrase, salt: fixture.salt)
        try expect(keyHex(key) == fixture.key_hex, "Swift CommonCrypto KDF differs from Web/Android")
        try XDriveIOSClipboardCrypto.verify(key: key, scope: fixture.aad_scope,
                                           nonce: fixture.vault_check.nonce,
                                           ciphertext: fixture.vault_check.ciphertext)
        let wrongPassword = try XDriveIOSClipboardCrypto.key(
            fixture.passphrase + " incorrect", salt: fixture.salt)
        try expect((try? XDriveIOSClipboardCrypto.verify(
            key: wrongPassword, scope: fixture.aad_scope,
            nonce: fixture.vault_check.nonce,
            ciphertext: fixture.vault_check.ciphertext)) == nil,
            "Wrong passphrase unlocked the vault")

        for item in fixture.items {
            let wire = XDriveIOSClipboardCrypto.Encrypted(
                client_event_id: item.client_event_id,
                kind: item.kind, nonce: item.nonce, ciphertext: item.ciphertext)
            try expect(try XDriveIOSClipboardCrypto.decrypt(
                wire, key: key, scope: fixture.aad_scope) == item.plaintext,
                "Web ciphertext cannot be decrypted by native Swift")
            let generated = try XDriveIOSClipboardCrypto.encrypt(
                item.plaintext, key: key, scope: fixture.aad_scope,
                eventID: item.client_event_id)
            try expect(try XDriveIOSClipboardCrypto.decrypt(
                generated, key: key, scope: fixture.aad_scope) == item.plaintext,
                "Native Swift roundtrip failed")
            try expect(generated.kind == item.kind, "Swift/Web URL kind differs")

            let wrongOwner = fixture.aad_scope.replacingOccurrences(of: ":42", with: ":43")
            try expect((try? XDriveIOSClipboardCrypto.decrypt(wire, key: key,
                                                              scope: wrongOwner)) == nil,
                       "Cross-Owner ciphertext accepted")
            let wrongEvent = XDriveIOSClipboardCrypto.Encrypted(
                client_event_id: "00000000-0000-4000-8000-000000000002",
                kind: wire.kind, nonce: wire.nonce, ciphertext: wire.ciphertext)
            try expect((try? XDriveIOSClipboardCrypto.decrypt(wrongEvent,
                key: key, scope: fixture.aad_scope)) == nil,
                "Modified EventID accepted")
            let wrongKind = XDriveIOSClipboardCrypto.Encrypted(
                client_event_id: wire.client_event_id,
                kind: wire.kind == "text/plain" ? "text/uri-list" : "text/plain",
                nonce: wire.nonce, ciphertext: wire.ciphertext)
            try expect((try? XDriveIOSClipboardCrypto.decrypt(wrongKind,
                key: key, scope: fixture.aad_scope)) == nil,
                "Modified AAD kind accepted")
            var damaged = try XCTUnwrapBase64(wire.ciphertext)
            damaged[damaged.startIndex] ^= 0x01
            let wrongCiphertext = XDriveIOSClipboardCrypto.Encrypted(
                client_event_id: wire.client_event_id, kind: wire.kind,
                nonce: wire.nonce, ciphertext: damaged.base64EncodedString())
            try expect((try? XDriveIOSClipboardCrypto.decrypt(
                wrongCiphertext, key: key, scope: fixture.aad_scope)) == nil,
                "Modified AES-GCM ciphertext accepted")
        }

        // Supplementary Unicode password vector: proves PBKDF2 counts UTF-8
        // bytes, not Swift String grapheme clusters or Java UTF-16 characters.
        let unicodeBytes = try Data(contentsOf: URL(
            fileURLWithPath: "docs/architecture/clipboard-interop-vectors.json"))
        let unicode = try JSONDecoder().decode(UnicodeClipboardFixture.self, from: unicodeBytes)
        try expect(unicode.schema_version == 1 && unicode.iterations == 310000,
                   "Unicode fixture version mismatch")
        let unicodeKey = try XDriveIOSClipboardCrypto.key(
            unicode.passphrase, salt: unicode.salt)
        try expect(keyHex(unicodeKey) == unicode.derived_key_hex,
                   "Unicode PBKDF2 does not match WebCrypto")
        let unicodeWire = XDriveIOSClipboardCrypto.Encrypted(
            client_event_id: unicode.client_event_id, kind: unicode.kind,
            nonce: unicode.nonce, ciphertext: unicode.ciphertext)
        try expect(try XDriveIOSClipboardCrypto.decrypt(
            unicodeWire, key: unicodeKey, scope: unicode.owner_scope) == unicode.plaintext,
            "Unicode password native decrypt differs from Web")
        print("PASS native CryptoKit/Swift Clipboard v1: Web + Android ciphertext, PBKDF2, Owner AAD, Unicode")
    }

    // Foundation strict base64 decode without adding XCTest to the app target.
    static func XCTUnwrapBase64(_ encoded: String) throws -> Data {
        guard let value = Data(base64Encoded: encoded), !value.isEmpty else {
            throw NSError(domain: "ClipboardV1Interop", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Bad fixture base64"])
        }
        return value
    }
}
