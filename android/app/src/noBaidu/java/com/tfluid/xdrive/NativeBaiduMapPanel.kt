package com.tfluid.xdrive

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.unit.Dp
import com.tfluid.xdrive.core.OwnerBd09Bounds
import com.tfluid.xdrive.core.OwnerBd09Cell
import com.tfluid.xdrive.core.OwnerBd09MapCells

/** Default master APK: no Android-specific AK, no Baidu SDK to initialize,
 * no third-party device information sent, and no invented basemap. */
internal fun nativeBaiduMapSdkCompiled(): Boolean = false

@Composable
internal fun NativeBaiduMapPanel(
    bounds: OwnerBd09Bounds,
    result: OwnerBd09MapCells,
    onOpenCell: (OwnerBd09Cell) -> Unit,
    onCameraStart: () -> Unit,
    onCameraSettled: (OwnerBd09Bounds?) -> Unit,
    markersEnabled: Boolean,
    preserveCamera: Boolean,
    savedCamera: NativeBaiduCameraPose?,
    onCameraSnapshot: (NativeBaiduCameraPose) -> Unit,
    photoCovers: Map<OwnerBd09Cell, ImageBitmap>,
    mapHeight: Dp,
    placeholder: @Composable () -> Unit,
) {
    // Real signed Owner records remain fully navigable through the existing
    // map cells and photo wall; this is deliberately NOT a fake tile layer.
    placeholder()
}
