package com.tfluid.xdrive

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException

/** Tile opt-in is a native, in-session view switch, not an SDK consent or
 * an Owner media permission. Default map entry never requests public tiles. */
@Composable
internal fun NativeLocalOsmToggle(enabled: Boolean, onToggle: () -> Unit) {
    TextButton(
        onClick = onToggle,
        modifier = Modifier.heightIn(min = 48.dp).testTag("native-local-osm-toggle"),
    ) { Text(if (enabled) "关闭 OSM 底图" else "启用 OSM 底图") }
}

/** Images stay in Compose, not WebView, a user-supplied URL or an SDK Host.
 * The policy provides at most 32 actual current-viewport XYZ tiles. */
@Composable
internal fun NativeLocalOsmMapLayer(
    plan: NativeLocalOsmPlan,
    onTileFailed: () -> Unit,
) {
    val context = LocalContext.current.applicationContext
    val currentOnError by rememberUpdatedState(onTileFailed)
    Box(Modifier.fillMaxSize().clipToBounds()
        .testTag("native-local-osm-map-layer")) {
        for (tile in plan.tiles) {
            key(tile.zoom, tile.x, tile.y, tile.leftDp, tile.topDp) {
                val picture by produceState<ImageBitmap?>(null, tile.url) {
                    try {
                        value = NativeLocalOsmTileLoader.image(context, tile)
                        if (value == null) currentOnError()
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        currentOnError()
                    }
                }
                if (picture != null) Image(
                    bitmap = picture!!,
                    contentDescription = null,
                    modifier = Modifier.offset(tile.leftDp.dp, tile.topDp.dp)
                        .size(tile.sizeDp.dp)
                        .testTag("native-local-osm-tile"),
                    contentScale = ContentScale.FillBounds,
                )
            }
        }
    }
}
