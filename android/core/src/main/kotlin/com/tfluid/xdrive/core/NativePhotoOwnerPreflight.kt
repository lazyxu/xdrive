package com.tfluid.xdrive.core

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** Proven by two authenticated, same-client Go GETs, never by local username. */
data class NativePhotoBackupScope(
    val origin: String,
    val serverInstanceId: String,
    val ownerId: Long,
    val username: String,
    val rootId: Long,
    val rootRevision: Long,
) {
    init {
        require(ServerAddress.parse(origin).url == origin && origin.startsWith("https://"))
        require(serverInstanceId.length in 1..256 && serverInstanceId.none { it.isISOControl() })
        require(ownerId > 0 && username.isNotBlank() && rootId > 0 && rootRevision > 0)
    }

    override fun toString() = "NativePhotoBackupScope([redacted])"
}

/**
 * Native photo backup prerequisite. Does NOT register a device, schedule work
 * or confer Server-admin permissions. A logout/Owner A->B->A must invalidate
 * the captured authentication generation before either API call can publish.
 */
object NativePhotoOwnerPreflight {
    suspend fun verify(
        service: XDriveService,
        origin: String,
        accessToken: String,
        expectedUsername: String,
        currentSession: () -> Boolean,
    ): NativePhotoBackupScope {
        val canonical = ServerAddress.parse(origin).url // forbids cleartext
        require(canonical == origin && accessToken.isNotBlank() &&
            expectedUsername.isNotBlank()) { "Invalid native photo backup session" }
        checkActive(currentSession)
        val me = service.verifiedOwnerIdentity(accessToken)
        checkActive(currentSession)
        check(me.username == expectedUsername) { "Owner identity changed" }
        val root = service.root(accessToken)
        checkActive(currentSession)
        check(root.id > 0 && root.isDirectory && root.parentId == null &&
            root.revision > 0) { "Unverified Owner root" }
        return NativePhotoBackupScope(
            origin = canonical,
            serverInstanceId = me.instanceId,
            ownerId = me.id,
            username = me.username,
            rootId = root.id,
            rootRevision = root.revision,
        )
    }

    private suspend fun checkActive(currentSession: () -> Boolean) {
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Native photo backup Owner session changed" }
    }
}
