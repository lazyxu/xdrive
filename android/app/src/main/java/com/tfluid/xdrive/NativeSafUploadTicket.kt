package com.tfluid.xdrive

/**
 * An Android ACTION_OPEN_DOCUMENT result can outlive its original verified
 * folder/Owner intent while an external provider answers metadata queries.
 * Capture the exact immutable Controller state at callback entry. Reusing only
 * the same displayed Owner/path IDs is unsafe for A -> B -> A navigation or a
 * second picker opened while the first provider is still responding.
 *
 * This ticket is transient memory only. It never persists provider URIs,
 * credentials, file bytes or a queue/resume promise.
 */
internal class NativeSafUploadTicket private constructor(
    private val exactPickerState: DriveState,
) {
    fun isCurrent(liveState: DriveState): Boolean =
        liveState === exactPickerState && validNativeSafUploadPicker(liveState)

    companion object {
        fun capture(state: DriveState): NativeSafUploadTicket? =
            if (validNativeSafUploadPicker(state)) NativeSafUploadTicket(state)
            else null
    }
}

/** Verify the real authenticated, loaded Browse target before inspecting any
 * untrusted provider metadata; Controller.acceptFileUpload rechecks again. */
internal fun validNativeSafUploadPicker(state: DriveState): Boolean {
    val folder = state.path.lastOrNull() ?: return false
    return state.screen == Screen.FILES && state.filesSection == FilesSection.BROWSE &&
        state.loaded && !state.loading && state.server.isNotBlank() &&
        state.username.isNotBlank() && state.fileUploadPickerParent == folder.id &&
        folder.id > 0L && folder.isDirectory &&
        state.path.all { it.id > 0L && it.isDirectory } &&
        !state.fileUploadActive && !state.fileDownloadActive &&
        state.fileExportPending == null && state.destinationKind == null &&
        !state.browseSelectionMode && !state.browseBatchWriteAttempted
}
