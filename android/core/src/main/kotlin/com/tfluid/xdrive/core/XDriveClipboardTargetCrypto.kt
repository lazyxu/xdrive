package com.tfluid.xdrive.core

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.SecureRandom
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * v2 targeted Clipboard: X25519/HKDF-SHA256/AES-256-GCM. The Server never gets
 * a private key or content key; only the authenticated Owner+recipient can read.
 * The format and AEAD boundaries match Web and iOS CryptoKit.
 */
object XDriveClipboardTargetCrypto {
    private const val CONTEXT = "xdrive-clipboard-target-v1"
    private const val MAX_BYTES = 65_536
    private val privatePrefix = byteArrayOf(0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x6e,0x04,0x22,0x04,0x20)

    data class DeviceKey(val publicKeyBase64: String, val pkcs8Private: ByteArray)

    data class Wire(
        val clientEventID: String, val targetDeviceID: String, val kind: String,
        val nonce: String, val ciphertext: String, val ephemeralKey: String,
        val wrappedKey: String, val nodeID: Long = 0L,
    )

    fun newDeviceKey(): DeviceKey {
        val privateKey = X25519PrivateKeyParameters(SecureRandom())
        return DeviceKey(Base64.getEncoder().encodeToString(privateKey.generatePublicKey().encoded),
            privatePrefix + privateKey.encoded)
    }

    private fun decode(text: String, expected: Int): ByteArray {
        require(text.length in 1..100_000)
        val bytes = Base64.getDecoder().decode(text)
        require(bytes.size == expected && Base64.getEncoder().encodeToString(bytes) == text)
        return bytes
    }

    private fun aad(scope: String, event: String, target: String, kind: String, nodeID: Long): String {
        require(scope.length in 1..512 &&
            UUID.fromString(event).toString() == event && UUID.fromString(target).toString() == target)
        require(nodeID >= 0L && (kind == "text/plain" || kind == "text/uri-list") == (nodeID == 0L))
        require(kind in setOf("text/plain", "text/uri-list", "image/x-xdrive-node-ref", "application/x-xdrive-node-ref"))
        return "$CONTEXT|$scope|$event|$target"
    }

    private fun wrappingKey(shared: ByteArray, context: String): SecretKeySpec {
        val salt = MessageDigest.getInstance("SHA-256").digest("$context|salt".toByteArray(Charsets.UTF_8))
        val extract = Mac.getInstance("HmacSHA256")
        extract.init(SecretKeySpec(salt, "HmacSHA256"))
        val prk = extract.doFinal(shared)
        return try {
            val expand = Mac.getInstance("HmacSHA256")
            expand.init(SecretKeySpec(prk, "HmacSHA256"))
            expand.update("$context|wrap".toByteArray(Charsets.UTF_8))
            expand.update(0x01.toByte())
            SecretKeySpec(expand.doFinal(), "AES")
        } finally {
            shared.fill(0)
            prk.fill(0)
        }
    }

    private fun keyExchange(privateBytes: ByteArray, peerPublic: ByteArray): ByteArray {
        require(peerPublic.size == 32 && privateBytes.size == privatePrefix.size + 32 &&
            privateBytes.copyOfRange(0, privatePrefix.size).contentEquals(privatePrefix))
        val privateKey = X25519PrivateKeyParameters(privateBytes, privatePrefix.size)
        val publicKey = X25519PublicKeyParameters(peerPublic)
        return ByteArray(32).also { privateKey.generateSecret(publicKey, it, 0) }
    }

    private fun open(key: SecretKeySpec, iv: ByteArray, ciphertextAndTag: ByteArray, aad: String): ByteArray {
        require(iv.size == 12 && ciphertextAndTag.size >= 17)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(ciphertextAndTag)
    }

    /** No user-visible text is returned for another target, Owner, or tampered Node ID. */
    fun decrypt(scope: String, deviceID: String, privateKey: ByteArray, message: Wire): String {
        require(message.targetDeviceID == deviceID)
        val context = aad(scope, message.clientEventID, deviceID, message.kind, message.nodeID)
        val shared = keyExchange(privateKey, decode(message.ephemeralKey, 32))
        val key = wrappingKey(shared, context)
        val wrapped = decode(message.wrappedKey, 60)
        val rawKey = open(key, wrapped.copyOfRange(0, 12), wrapped.copyOfRange(12, 60),
            "$context|key|" + message.kind + "|" + message.nodeID)
        try {
            require(rawKey.size == 32)
            val iv = decode(message.nonce, 12)
            require(message.ciphertext.length in 24..90_000)
            val content = Base64.getDecoder().decode(message.ciphertext)
            require(content.size in 17..MAX_BYTES + 16)
            val clear = open(SecretKeySpec(rawKey, "AES"), iv, content,
                "$context|content|" + message.kind + "|" + message.nodeID)
            try {
                require(clear.size in 1..MAX_BYTES)
                return Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(clear)).toString()
            } finally { clear.fill(0) }
        } finally { rawKey.fill(0) }
    }
}
