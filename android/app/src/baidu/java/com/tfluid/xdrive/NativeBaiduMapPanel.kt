package com.tfluid.xdrive

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.baidu.mapapi.SDKInitializer
import com.baidu.mapapi.map.BaiduMap
import com.baidu.mapapi.map.BitmapDescriptor
import com.baidu.mapapi.map.BitmapDescriptorFactory
import com.baidu.mapapi.map.MapStatusUpdateFactory
import com.baidu.mapapi.map.MapView
import com.baidu.mapapi.map.Marker
import com.baidu.mapapi.map.MarkerOptions
import com.baidu.mapapi.model.LatLng
import com.baidu.mapapi.model.LatLngBounds
import com.tfluid.xdrive.core.OwnerBd09Bounds
import com.tfluid.xdrive.core.OwnerBd09Cell
import com.tfluid.xdrive.core.OwnerBd09MapCells
import java.util.IdentityHashMap

/** This implementation is built ONLY with an Android-specific signed Baidu AK.
 * The default master APK compiles the noBaidu adapter and has no SDK binary. */
internal fun nativeBaiduMapSdkCompiled(): Boolean = true

private const val SDK_PRIVACY_PREFERENCES = "baidu-map-sdk-privacy"
private const val SDK_PRIVACY_VERSION = "map-8.2.0-accepted"

private object BaiduMapStartup {
    private var started = false

    /** Never initialize the provider without affirmative SDK privacy consent.
     * The caller must be on the main thread, before creating a MapView. */
    @Synchronized fun ensureInitialized(context: Context) {
        if (started) return
        val application = context.applicationContext
        SDKInitializer.setAgreePrivacy(application, true)
        SDKInitializer.initialize(application)
        started = true
    }

    @Synchronized fun revoke(context: Context) {
        SDKInitializer.setAgreePrivacy(context.applicationContext, false)
        started = false
    }
}

/** One MapView and one bounded set of Owner-signed BD09 pins. The marker map
 * contains no bearer token, private image bytes, origin or persisted IDs.
 * Tap always calls the existing Controller, which re-verifies the exact cell
 * against the currently authenticated Owner response before any Gallery GET. */
private class NativeBaiduLease(val view: MapView) {
    private val bindings = IdentityHashMap<Marker, OwnerBd09Cell>()
    private val icons = mutableListOf<BitmapDescriptor>()
    private var lastBounds: OwnerBd09Bounds? = null
    private var lastPins: List<OwnerBd09Cell>? = null
    var onSelect: (OwnerBd09Cell) -> Unit = {}
    private var closed = false

    init {
        view.showZoomControls(false)
        val baidu = view.map
        baidu.setMyLocationEnabled(false) // No device GPS or location permission.
        baidu.setOnMarkerClickListener(BaiduMap.OnMarkerClickListener { marker ->
            val signedCell = bindings[marker] ?: return@OnMarkerClickListener false
            onSelect(signedCell)
            true
        })
    }

    fun draw(bounds: OwnerBd09Bounds, pins: List<OwnerBd09Cell>) {
        if (closed || (lastBounds == bounds && lastPins == pins)) return
        val baidu = view.map
        baidu.clear()
        bindings.clear()
        icons.forEach { it.recycle() }
        icons.clear()
        val changedBounds = lastBounds != bounds
        lastBounds = bounds
        lastPins = pins.toList()

        for (cell in pins) {
            val icon = countMarker(cell.photoCount)
            icons += icon
            val marker = baidu.addOverlay(
                MarkerOptions()
                    .position(LatLng(cell.latitude, cell.longitude))
                    .icon(icon),
            ) as? Marker ?: continue
            bindings[marker] = cell
        }

        // Only reposition for a new verified Owner rectangle, not after every
        // Compose render; users may freely pan/zoom existing signed points.
        if (changedBounds && pins.isNotEmpty()) {
            val first = pins.first()
            val uniquePlaces = pins.map { it.latitude to it.longitude }.toSet()
            if (uniquePlaces.size == 1) {
                baidu.setMapStatus(MapStatusUpdateFactory.newLatLngZoom(
                    LatLng(first.latitude, first.longitude), 10f))
            } else {
                val builder = LatLngBounds.Builder()
                pins.forEach { builder.include(LatLng(it.latitude, it.longitude)) }
                baidu.setMapStatus(MapStatusUpdateFactory.newLatLngBounds(
                    builder.build()))
            }
        }
    }

    fun close() {
        if (closed) return
        closed = true
        bindings.clear()
        try {
            view.onPause()
        } finally {
            try { view.onDestroy() }
            finally {
                icons.forEach { it.recycle() }
                icons.clear()
            }
        }
    }

    private fun countMarker(count: Long): BitmapDescriptor {
        // A native drawn marker with its ACTUAL Go-reported count, not a
        // speculative cover bitmap or an additional Owner thumbnail request.
        val bitmap = Bitmap.createBitmap(84, 48, Bitmap.Config.ARGB_8888)
        try {
            val canvas = AndroidCanvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            paint.color = AndroidColor.rgb(12, 104, 210)
            canvas.drawRoundRect(1f, 1f, 83f, 45f, 23f, 23f, paint)
            paint.color = AndroidColor.WHITE
            paint.textAlign = Paint.Align.CENTER
            paint.textSize = 22f
            paint.isFakeBoldText = true
            val label = if (count >= 10_000L) "9999+" else count.toString()
            canvas.drawText(label, 42f, 31f, paint)
            return BitmapDescriptorFactory.fromBitmap(bitmap)
        } finally {
            bitmap.recycle()
        }
    }
}

@Composable
internal fun NativeBaiduMapPanel(
    bounds: OwnerBd09Bounds,
    result: OwnerBd09MapCells,
    onOpenCell: (OwnerBd09Cell) -> Unit,
    placeholder: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val preferences = remember(context) {
        context.applicationContext.getSharedPreferences(
            SDK_PRIVACY_PREFERENCES, Context.MODE_PRIVATE)
    }
    var agreed by remember(preferences) {
        mutableStateOf(preferences.getBoolean(SDK_PRIVACY_VERSION, false))
    }

    // Exactly the authenticated, signed ≤64 BD09 points. Never convert
    // WGS84 data on-device, guess map bounds, or send an entire photo library.
    val pins = nativeVerifiedBaiduPins(bounds, result)
    if (pins == null) {
        Text("当前地图范围数据校验失败，已停止第三方地图显示。请重新读取当前账户网格。",
            modifier = Modifier.testTag("native-baidu-invalid-pins"),
            color = MaterialTheme.colorScheme.error)
        return
    }

    if (!agreed) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("原生底图由北京百度网讯科技有限公司提供的百度地图 Android SDK（8.2.0）呈现。启用后，SDK 可能处理设备标识、系统及网络信息，并显示最多 64 个当前账户已验证的 BD-09 聚合代表坐标。xDrive 不向 SDK 提供照片、文件名或登录令牌；也不申请手机定位权限。请先阅读其隐私政策，再自主决定是否启用。",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("native-baidu-privacy-description"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = {
                    // Official Android map SDK compliance policy, no key or
                    // provider initialization before this user decision.
                    preferences.edit().putBoolean(SDK_PRIVACY_VERSION, true).apply()
                    agreed = true
                }, modifier = Modifier.testTag("native-baidu-enable")) {
                    Text("同意并启用真实底图")
                }
                TextButton(onClick = {
                    uriHandler.openUri(
                        "https://lbs.baidu.com/docs/pcsa?title=compliance/openprivacy")
                }, modifier = Modifier.testTag("native-baidu-privacy-link")) {
                    Text("隐私说明")
                }
            }
            placeholder() // Existing map/list remains usable before consent.
        }
        return
    }

    val host = remember(context, agreed) {
        try {
            BaiduMapStartup.ensureInitialized(context)
            NativeBaiduLease(MapView(context))
        } catch (_: Exception) {
            null
        } catch (_: LinkageError) {
            null // Missing OEM native library must not crash the Gallery.
        }
    }
    val lifecycle = LocalLifecycleOwner.current
    val currentOnSelect by rememberUpdatedState(onOpenCell)
    DisposableEffect(host, lifecycle) {
        if (host == null) onDispose {} else {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_RESUME -> host.view.onResume()
                    Lifecycle.Event.ON_PAUSE -> host.view.onPause()
                    else -> Unit
                }
            }
            lifecycle.lifecycle.addObserver(observer)
            if (lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
                host.view.onResume()
            onDispose {
                lifecycle.lifecycle.removeObserver(observer)
                host.close()
                if (!preferences.getBoolean(SDK_PRIVACY_VERSION, false))
                    BaiduMapStartup.revoke(context)
            }
        }
    }

    if (host == null) {
        Text("百度地图无法启动，请检查 Android AK、签名 SHA-1、SDK 架构或设备网络。下方仍可使用已验证的聚合网格。",
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("native-baidu-unavailable"))
        placeholder()
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            AndroidView(
                factory = { host.view },
                update = {
                    host.onSelect = { cell -> currentOnSelect(cell) }
                    host.draw(bounds, pins)
                },
                modifier = Modifier.fillMaxWidth().height(290.dp)
                    .testTag("native-baidu-map"),
            )
            Text("百度原生底图 · ${pins.size} 个经服务端验证的 BD-09 聚合点。点击数量标记打开对应网格照片；拖动/缩放仅改变可视范围，尚未重新查询新范围。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(
                onClick = {
                    // Only a genuine explicit revocation changes the provider
                    // consent flag. Navigating away leaves one-time choice.
                    preferences.edit().putBoolean(SDK_PRIVACY_VERSION, false).apply()
                    agreed = false // onDispose closes MapView before SDK revoke.
                },
                modifier = Modifier.testTag("native-baidu-disable"),
            ) { Text("停用第三方底图") }
        }
    }
}
