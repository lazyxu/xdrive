package com.tfluid.xdrive

import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.XDriveService
import com.tfluid.xdrive.core.validDriveNodeName
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/**
 * One explicitly reviewed Owner original, not an automatic backup scheduler
 * or another CAS writer. The existing XDriveService.uploadFile implements the
 * Go UploadSession/chunk/finalize flow; an uncertain ACK must not be retried.
 */
internal object NativePhotoOneShotUploader {
    suspend fun upload(
        service: XDriveService,
        token: String,
        owner: NativePhotoBackupScope,
        root: DriveNode,
        name: String,
        original: NativePhotoStagedOriginal,
        currentSession: () -> Boolean,
        onProgress: (Long) -> Unit = {},
    ): DriveNode {
        require(token.isNotBlank() && validDriveNodeName(name) && original.bytes > 0)
        check(root.id == owner.rootId && root.revision == owner.rootRevision &&
            root.id > 0 && root.isDirectory && root.parentId == null) {
            "Photo backup root is not the verified Owner root"
        }
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Owner session was invalidated" }
        check(original.verifyBeforeWrite()) {
            "Photo original changed before UploadSession"
        }
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Owner session was invalidated" }
        val result = service.uploadFile(token, root, name, original.bytes,
            original::openVerifiedSource) { confirmed ->
            if (!currentSession()) throw CancellationException("Owner session changed")
            onProgress(confirmed)
        }
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Owner session invalid after finalize" }
        check(result.id > 0 && result.parentId == owner.rootId &&
            result.type == "file" && result.name == name &&
            result.size == original.bytes && result.revision > 0) {
            "UploadSession returned an invalid Owner Node receipt"
        }
        return result
    }
}
