package com.tfluid.xdrive

/** One in-memory ACTION_CREATE_DOCUMENT launch, not a stored URI or download
 * authorization. ActivityResult callbacks are asynchronous and cannot carry
 * the original app Owner, folder, file revision or session epoch. Keep the
 * exact immutable DriveState object created by prepareFileExport.
 *
 * A callback from old A->B->A navigation or a replaced document picker must
 * never become an output stream for the new Owner's file.
 */
internal class NativeSafExportTicket private constructor(
    private val exactPickerState: DriveState,
) {
    fun isCurrent(liveState: DriveState): Boolean =
        liveState === exactPickerState && validNativeSafExportPicker(liveState)

    companion object {
        fun capture(state: DriveState): NativeSafExportTicket? =
            if (validNativeSafExportPicker(state)) NativeSafExportTicket(state)
            else null
    }
}

/** Mirrors the real Controller.saveFileExport Owner/loaded-row preflight.
 * This check runs BEFORE touching any provider output bytes; the Controller
 * independently validates again before the original HTTPS download begins.
 */
internal fun validNativeSafExportPicker(state: DriveState): Boolean {
    val node = state.fileExportPending ?: return false
    if (state.server.isBlank() || state.username.isBlank() ||
        state.loading || node.id <= 0L || node.isDirectory ||
        node.revision <= 0L || node.size < 0L ||
        state.fileDownloadActive || state.fileUploadActive ||
        state.fileUploadPickerParent != null || state.destinationKind != null ||
        state.browseBatchWriteAttempted) return false

    return when (state.fileExportOrigin) {
        Screen.FILES -> {
            val folder = state.path.lastOrNull()
            state.screen == Screen.FILES &&
                state.filesSection == FilesSection.BROWSE &&
                state.loaded && !state.browseSelectionMode &&
                folder != null && folder.id > 0L && folder.isDirectory &&
                state.path.all { it.id > 0L && it.isDirectory } &&
                node.parentId == folder.id &&
                state.items.any { it == node }
        }
        Screen.GALLERY ->
            state.screen == Screen.GALLERY && state.galleryLoaded &&
                state.gallerySelected?.node == node &&
                state.galleryItems.any { it.node == node }
        else -> false
    }
}

/** One old OS result may arrive after a new Owner or a different export
 * intent is visible. Only the exact original state can be cancelled/saved.
 * A stale callback must NEVER clear a subsequent Owner's pending export. */
internal enum class NativeSafExportCallbackDecision {
    IGNORE_STALE, CANCEL_CURRENT, SAVE_CURRENT,
}

internal fun nativeSafExportCallbackDecision(
    ticket: NativeSafExportTicket?,
    liveState: DriveState,
    validContentUri: Boolean,
): NativeSafExportCallbackDecision = when {
    ticket == null || !ticket.isCurrent(liveState) ->
        NativeSafExportCallbackDecision.IGNORE_STALE
    !validContentUri ->
        NativeSafExportCallbackDecision.CANCEL_CURRENT
    else -> NativeSafExportCallbackDecision.SAVE_CURRENT
}
