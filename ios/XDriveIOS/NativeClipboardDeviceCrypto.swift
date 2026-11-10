import CryptoKit
import Foundation
import Security

// Device delivery is independent of the shared text-vault passphrase.
// The user must explicitly enroll an already-verified installation, after
// which its X25519 private key stays in this iPhone's ThisDeviceOnly Keychain.
enum XDriveIOSClipboardDeviceCrypto {
    enum Failure: Error { case invalidKey, invalidEnvelope, keychain(OSStatus) }
    private static let service = "com.lazyxu.xdrive.ios.clipboard-x25519.v1"

    static func privateKey(owner: XDriveNativeOwnerRoot) throws -> Curve25519.KeyAgreement.PrivateKey {
        let scope = [owner.origin.absoluteString, owner.instanceID,
                     String(owner.ownerID), String(owner.rootNodeID), owner.username].joined(separator: "|")
        let name = Data(SHA256.hash(data: Data(scope.utf8))).base64EncodedString()
        let attrs: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: name
        ]
        var query = attrs
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = kCFBooleanTrue
        var raw: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &raw)
        if status == errSecSuccess {
            guard let data = raw as? Data else { throw Failure.invalidKey }
            return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: data)
        }
        guard status == errSecItemNotFound else { throw Failure.keychain(status) }
        let generated = Curve25519.KeyAgreement.PrivateKey()
        var save = attrs
        save[kSecValueData as String] = generated.rawRepresentation
        save[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let inserted = SecItemAdd(save as CFDictionary, nil)
        if inserted == errSecDuplicateItem {
            // A simultaneous opt-in action may have stored the same scope;
            // never replace its private key or rotate the Server public key.
            var existing: CFTypeRef?
            let loaded = SecItemCopyMatching(query as CFDictionary, &existing)
            guard loaded == errSecSuccess, let data = existing as? Data else {
                throw Failure.keychain(loaded)
            }
            return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: data)
        }
        guard inserted == errSecSuccess else { throw Failure.keychain(inserted) }
        return generated
    }

    // The Native sender produces exactly the WebCrypto v2 wire. Only the
    // recipient's published public key enters the sender; the private key
    // never leaves its own device, and the Server receives neither key.
    static func encryptForDevice(
        _ clear: String, ownerScope: String, deviceID: String, publicKey: String,
        kind: String, nodeID: UInt64 = 0,
        eventID: String = UUID().uuidString.lowercased()
    ) throws -> XDriveIOSClipboardDirectedWrite {
        let plain = Data(clear.utf8)
        guard (1...65_536).contains(plain.count),
              ownerScope.utf8.count <= 512, !ownerScope.isEmpty,
              UUID(uuidString: deviceID) != nil, UUID(uuidString: eventID) != nil,
              let recipientRaw = Data(base64Encoded: publicKey),
              recipientRaw.count == 32, recipientRaw.contains(where: { $0 != 0 }) else {
            throw Failure.invalidEnvelope
        }
        let isText = kind == "text/plain" || kind == "text/uri-list"
        let isReference = kind == "image/x-xdrive-node-ref" ||
                          kind == "application/x-xdrive-node-ref"
        guard (isText && nodeID == 0) || (isReference && nodeID > 0) else {
            throw Failure.invalidEnvelope
        }
        let recipient = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: recipientRaw)
        let ephemeral = Curve25519.KeyAgreement.PrivateKey()
        let shared = try ephemeral.sharedSecretFromKeyAgreement(with: recipient)
        let context = "xdrive-clipboard-target-v1|\(ownerScope)|\(eventID)|\(deviceID)"
        let salt = Data(SHA256.hash(data: Data((context + "|salt").utf8)))
        let wrapKey = shared.hkdfDerivedSymmetricKey(
            using: SHA256.self, salt: salt,
            sharedInfo: Data((context + "|wrap").utf8), outputByteCount: 32)
        let contentKey = SymmetricKey(size: .bits256)
        let keyBytes = contentKey.withUnsafeBytes { Data($0) }
        let wrappedNonce = AES.GCM.Nonce()
        let wrapped = try AES.GCM.seal(keyBytes, using: wrapKey,
            nonce: wrappedNonce,
            authenticating: Data((context + "|key|\(kind)|\(nodeID)").utf8))
        let nonce = AES.GCM.Nonce()
        let cipher = try AES.GCM.seal(plain, using: contentKey,
            nonce: nonce,
            authenticating: Data((context + "|content|\(kind)|\(nodeID)").utf8))
        return XDriveIOSClipboardDirectedWrite(
            client_event_id: eventID, kind: kind,
            target_device_id: deviceID,
            ephemeral_key: ephemeral.publicKey.rawRepresentation.base64EncodedString(),
            wrapped_key: (Data(wrappedNonce) + wrapped.ciphertext + wrapped.tag).base64EncodedString(),
            nonce: Data(nonce).base64EncodedString(),
            ciphertext: (cipher.ciphertext + cipher.tag).base64EncodedString(),
            node_id: nodeID > 0 ? nodeID : nil
        )
    }

    static func decrypt(_ item: XDriveIOSClipboardItem, ownerScope: String,
                        deviceID: String, privateKey: Curve25519.KeyAgreement.PrivateKey) throws -> String {
        guard item.target_device_id == deviceID,
              let ephemeralRaw = Data(base64Encoded: item.ephemeral_key ?? ""),
              ephemeralRaw.count == 32,
              let wrapped = Data(base64Encoded: item.wrapped_key ?? ""),
              wrapped.count == 60,
              let nonceRaw = Data(base64Encoded: item.nonce), nonceRaw.count == 12,
              let ciphertext = Data(base64Encoded: item.ciphertext),
              (17...65_552).contains(ciphertext.count) else { throw Failure.invalidEnvelope }
        let nodeID = item.node_id ?? 0
        if item.kind == "text/plain" || item.kind == "text/uri-list" {
            guard nodeID == 0 else { throw Failure.invalidEnvelope }
        } else {
            guard (item.kind == "image/x-xdrive-node-ref" ||
                   item.kind == "application/x-xdrive-node-ref") && nodeID > 0 else {
                throw Failure.invalidEnvelope
            }
        }
        let context = "xdrive-clipboard-target-v1|\(ownerScope)|\(item.client_event_id)|\(deviceID)"
        let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: ephemeralRaw)
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: peer)
        let salt = Data(SHA256.hash(data: Data((context + "|salt").utf8)))
        let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt,
            sharedInfo: Data((context + "|wrap").utf8), outputByteCount: 32)
        let aadKey = Data((context + "|key|\(item.kind)|\(nodeID)").utf8)
        let wrapNonce = try AES.GCM.Nonce(data: wrapped.prefix(12))
        let wrapBox = try AES.GCM.SealedBox(nonce: wrapNonce,
            ciphertext: wrapped.dropFirst(12).prefix(32), tag: wrapped.suffix(16))
        let secret = try AES.GCM.open(wrapBox, using: key, authenticating: aadKey)
        guard secret.count == 32 else { throw Failure.invalidEnvelope }
        let contentKey = SymmetricKey(data: secret)
        let contentNonce = try AES.GCM.Nonce(data: nonceRaw)
        let contentBox = try AES.GCM.SealedBox(nonce: contentNonce,
            ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
        let clear = try AES.GCM.open(contentBox, using: contentKey,
            authenticating: Data((context + "|content|\(item.kind)|\(nodeID)").utf8))
        guard (1...65_536).contains(clear.count),
              let text = String(data: clear, encoding: .utf8) else { throw Failure.invalidEnvelope }
        return text
    }
}
