package com.tfluid.xdrive

import java.security.MessageDigest

/**
 * Stable, unguessable namespace for an already journaled Android Photo
 * original. The per-intent random UUID was persisted BEFORE any POST and
 * has >120 bits of randomness. SHA-256 prevents leaking that local UUID.
 * Never include the key in a URL, notification, debug log or persisted task.
 */
internal object NativePhotoResumeKey {
    fun forIntent(intent: NativePhotoBackupIntent): String {
        val parts = listOf(
            "xdrive:android:photo-upload:v1", intent.id,
            intent.owner.serverOrigin, intent.owner.instanceId,
            intent.owner.ownerId.toString(), intent.owner.username,
            intent.owner.rootNodeId.toString(), intent.owner.deviceId,
            intent.assetKey, intent.versionKey, intent.resource.name,
            intent.originalSha256, intent.sizeBytes.toString(),
        )
        // Length prefixes prevent ambiguous field boundaries without a key
        // derivation secret or a new at-rest encryption layer.
        val digest = MessageDigest.getInstance("SHA-256")
        parts.forEach { part ->
            val bytes = part.toByteArray(Charsets.UTF_8)
            require(bytes.size in 1..4096)
            digest.update(byteArrayOf(
                (bytes.size ushr 24).toByte(), (bytes.size ushr 16).toByte(),
                (bytes.size ushr 8).toByte(), bytes.size.toByte()))
            digest.update(bytes)
        }
        return "and_" + digest.digest().joinToString("") { byte ->
            "%02x".format(byte.toInt() and 0xff)
        }
    }
}
