package com.tfluid.xdrive

import android.content.ContentUris
import android.provider.MediaStore
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Real native Compose map-cell hit targets; no remote map provider or GPS. */
class NativeLocalMapViewportUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun scannedMapCoverBecomesClickableBeforeFullScanAndDisablesOnError() {
        val local = NativeLocalMedia(
            11L,
            ContentUris.withAppendedId(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, 11L),
            false, "camera", "Camera", 1700000000,
        )
        val cell = NativeLocalMapCell(
            key = requireNotNull(NativeLocalMapIndex.keyFor(35.0, 139.0, 0)),
            latitude = 35.0, longitude = 139.0, representative = local,
            count = 1, firstSeen = 1, members = listOf(local),
        )
        val scanned = mutableIntStateOf(0)
        val located = mutableIntStateOf(0)
        val failure = mutableStateOf<String?>(null)
        var selected = 0
        compose.setContent {
            XDriveTheme {
                Column(Modifier.width(390.dp).height(500.dp)) {
                    NativeLocalPhotoMapCanvas(listOf(cell),
                        selectable = nativeLocalMapCanOpenScannedCells(
                            scanned.intValue, located.intValue, failure.value),
                    ) { selected++ }
                }
            }
        }
        val tag = "native-local-map-cell-" +
            cell.key.latitudeCell + "-" + cell.key.longitudeCell
        compose.onNodeWithTag(tag).assertIsNotEnabled()
        compose.runOnIdle {
            // A full 100k scan is still in progress, but one keyset page
            // and a real GPS-bearing cover have already been indexed.
            scanned.intValue = 64
            located.intValue = 1
        }
        compose.onNodeWithTag(tag).assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, selected) }

        compose.runOnIdle { failure.value = "MediaStore grant was revoked" }
        compose.onNodeWithTag(tag).assertIsNotEnabled()
    }

    @Test fun datelineCellsAreBothReachableInFittedPhoneViewport() {
        fun cell(id: Long, lon: Double): NativeLocalMapCell<NativeLocalMedia> {
            val local = NativeLocalMedia(
                id,
                ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id),
                false, "camera", "Camera", 1700000000,
            )
            return NativeLocalMapCell(
                key = requireNotNull(NativeLocalMapIndex.keyFor(5.0, lon, 0)),
                latitude = 5.0, longitude = lon, representative = local,
                count = 1, firstSeen = id.toInt(), members = listOf(local),
            )
        }
        val a = cell(1, 179.9)
        val b = cell(2, -179.9)
        var chosen = 0L
        compose.setContent {
            XDriveTheme {
                Column(Modifier.width(390.dp).height(500.dp)) {
                    NativeLocalPhotoMapCanvas(listOf(a,b), selectable = true) {
                        chosen = it.representative.id
                    }
                }
            }
        }
        val first = "native-local-map-cell-" +
            a.key.latitudeCell + "-" + a.key.longitudeCell
        val second = "native-local-map-cell-" +
            b.key.latitudeCell + "-" + b.key.longitudeCell
        compose.onNodeWithTag(first).assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1L, chosen) }
        compose.onNodeWithTag("native-local-map-zoom-in").performClick()
        compose.onNodeWithTag("native-local-map-fit").performClick()
        compose.onNodeWithTag(second).assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(2L, chosen) }
    }
}
