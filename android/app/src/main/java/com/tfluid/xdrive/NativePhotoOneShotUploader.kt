package com.tfluid.xdrive

import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.NativeAndroidDeviceEnrollment
import com.tfluid.xdrive.core.NativeAndroidPhotoDestination
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
    /**
     * One Android Photo original through the verified managed Source/Target
     * alias. The ordinary Owner root remains a proof of identity only, never
     * the destination or a fallback if this capability is unavailable.
     */
    suspend fun uploadManaged(
        service: XDriveService,
        token: String,
        owner: NativePhotoBackupScope,
        verifiedRoot: DriveNode,
        device: NativeAndroidDeviceEnrollment,
        destination: NativeAndroidPhotoDestination,
        name: String,
        original: NativePhotoStagedOriginal,
        resumeKey: String,
        currentSession: () -> Boolean,
        onProgress: (Long) -> Unit = {},
    ): DriveNode {
        require(token.isNotBlank() && validDriveNodeName(name) && original.bytes > 0)
        check(verifiedRoot.id == owner.rootId &&
            verifiedRoot.revision == owner.rootRevision &&
            verifiedRoot.isDirectory && verifiedRoot.parentId == null)
        check(destination.configured && destination.deviceId == device.deviceId &&
            destination.targetNodeId != null && destination.sourceId != null &&
            destination.sourceRevision != null && destination.name != null &&
            destination.acceptsServerManagedPath()
        currentCoroutineContext().ensureActive()
        check(currentSession() && original.verifyBeforeWrite()) {
            "Photo original or Owner changed before managed upload"
        }
        val progress: (Long) -> Unit = { confirmed ->
            if (!currentSession()) throw CancellationException("Managed original Owner changed")
            onProgress(confirmed)
        }
        val result = service.uploadManagedAndroidPhotoOriginal(
            token, device, destination, name, original.bytes,
            original.sha256, resumeKey, original::openVerifiedSource, progress)
        currentCoroutineContext().ensureActive()
        check(currentSession() && result.id > 0 &&
            result.parentId == destination.targetNodeId &&
            result.type == "file" && result.name == name &&
            result.size == original.bytes && result.revision > 0) {
            "Managed Android original returned an invalid Source/Node receipt"
        }
        return result
    }

    suspend fun upload(
        service: XDriveService,
        token: String,
        owner: NativePhotoBackupScope,
        root: DriveNode,
        name: String,
        original: NativePhotoStagedOriginal,
        currentSession: () -> Boolean,
        onProgress: (Long) -> Unit = {},
        resumeKey: String? = null,
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
        val progress: (Long) -> Unit = { confirmed ->
            if (!currentSession()) throw CancellationException("Owner session changed")
            onProgress(confirmed)
        }
        val result = if (resumeKey != null) service.uploadNativePhotoOriginal(
            token, root, name, original.bytes, original.sha256, resumeKey,
            original::openVerifiedSource, progress)
        else service.uploadFile(token, root, name, original.bytes,
            original::openVerifiedSource, progress)
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
