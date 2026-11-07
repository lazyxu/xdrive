package com.tfluid.xdrive.core

/** Exact authenticated Owner Clipboard v1 wire contract. Never expose decrypted
 * text, passphrases or keys from HTTP DTOs or write them into persistent state.
 */
data class OwnerClipboardVault(
    val ownerId: Long,
    val salt: String,
    val iterations: Int,
    val kdf: String,
    val checkNonce: String,
    val checkCiphertext: String,
    val aadScope: String,
)

data class OwnerClipboardWrite(
    val clientEventId: String,
    val kind: String,
    val nonce: String,
    val ciphertext: String,
)

data class OwnerClipboardItem(
    val id: Long,
    val clientEventId: String,
    val kind: String,
    val nonce: String,
    val ciphertext: String,
    val createdAt: String,
    val expiresAt: String,
) {
    fun encrypted() = OwnerClipboardWrite(clientEventId, kind, nonce, ciphertext)
}

data class OwnerClipboardPage(
    val items: List<OwnerClipboardItem>,
    val nextBefore: Long?,
)

data class OwnerClipboardVerifier(
    val nonce: String,
    val ciphertext: String,
    val scope: String,
)
