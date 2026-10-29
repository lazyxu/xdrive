# Android native Baidu basemap: signed Owner BD09 points (2026-10-29)

## What is real, and what remains

The native Android Gallery already has the authenticated Go BD09 /cells range,
owner/version-checked 8×8 aggregation, 64 representative points, drilled
subranges, tap-to-Gallery wall and Gallery Viewer return. The default master
Debug APK continues to use the **truthfully labeled non-basemap distribution**
and the original signed cell list.

This increment adds a **real Android Baidu MapView** and count-marker overlay
*only for a separately configured Android-key APK*. It does not manufacture
Baidu tiles, fake a map in the default APK, convert WGS84 to BD09 in Android or
infer membership from a device GPS permission. Rendering verified points is
not proof that the real iOS 27 Maps camera UI, animation or clustering look
identical. Camera gestures work locally in the SDK; **new camera rectangle ->
server requery is not implemented in this increment**. The native map explains
that only the current verified rectangle is represented. On-screen cell rows
still offer full signed drilldown and one exact map-cell Gallery Range.

## Independent build variant (no AK in Git)

The exact **map-only**, Maven Central SDK artifact and version below are from
the official Baidu Android Gradle documentation. It is the Mainland China
distribution; international/Google channel packaging must be separately
verified before shipping.

```bash
# Ordinary automated master build; does NOT fetch, bundle or initialize Baidu.
cd android
./gradlew --no-daemon :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug

# Android-key-aware build. Use an Android-platform Baidu AK registered for
# this *exact* applicationId and the *actual* APK-signing SHA-1.
# Do not commit or echo the real key in logs or shell history.
./gradlew --no-daemon -PxdriveBaiduAndroidMapAk=YOUR_ANDROID_PLATFORM_AK \
  :app:compileDebugKotlin :app:assembleDebug
```

When no AK is set, Gradle compiles only
`app/src/noBaidu/java/com/tfluid/xdrive/NativeBaiduMapPanel.kt`, with
zero Baidu SDK dependencies. When the property is supplied, it compiles only
`app/src/baidu/java/com/tfluid/xdrive/NativeBaiduMapPanel.kt` and adds
`com.baidu.lbsyun:BaiduMapSDK_Map:8.2.0`. Never combine both implementations,
the search/navigation SDK, or a browser-type AK. The manifest placeholder is
empty in the ordinary build. Baidu Android authorization depends on both
package `com.tfluid.xdrive` and signing certificate SHA-1; GitHub Actions
debug and a locally built debug APK may have different ephemeral signatures.
A usable Android AK cannot be inferred from the existing Go/Browser AK.

Because **SDK dependencies are absent from the default build**, normal master
CI can validate the optional host interface, Kotlin marker policy and
unchanged fallback, but it cannot validate the Baidu-specific Kotlin source or
runtime. A dedicated opt-in compile (command above), actual SDK initialization,
device/ABI, connected API35 tests and genuine Android AK/signature are
**not verified** until executed. Never count a default green CI as SDK-variant
green. Do not make this experimental variant the production build default.

## Security and privacy boundaries

- No map SDK class, map service or provider network operation is initialized
  by default. In the opt-in APK, an explicit first-use UI disclosure names
  Beijing Baidu Netcom Science Technology Co., Ltd., the SDK version, use,
  potential device/network data, and provides an actual clickable provider
  privacy-policy link. The user must affirmatively enable before
  `SDKInitializer.setAgreePrivacy(application, true)` then
  `SDKInitializer.initialize(application)`. No prechecked checkbox.
  A local versioned non-Owner boolean remembers this one-time app choice;
  it can be revoked from the same map pane.
- The original signed Owner /cells API is the only source for overlay cells.
  `nativeVerifiedBaiduPins` rejects invalid rectangles, count mismatch,
  duplicate grid slots, invalid identities or more than 64 returned records.
  It does not fetch media, create grants, persist map records or upload photos.
  Marker taps call the existing `DriveController.openGalleryBd09Cell(cell)`;
  that Controller checks the exact currently loaded Owner DTO again.
- No Android device location, telephony or broad storage permission is
  requested. `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  `READ_PHONE_STATE` and `WRITE_EXTERNAL_STORAGE` are explicitly
  removed from merged manifests if transitively requested by the SDK.
  Run `:app:processDebugMainManifest` with the opt-in build and inspect the
  **merged** output for any unexpected permissions or components.
- The MapView has a real Activity-aware resume/pause/destroy lifecycle;
  overlays and BitmapDescriptor instances are retired when it exits.
  SDK initialization or native-lib/AK failure leaves the original
  authenticated non-provider grid visible, **not** a white/fake map.
- Actual map SDK marker rendering can transmit up to 64 representative BD09
  coordinates to the provider, only after the provider-privacy consent. This
  is distinct from the Go service's Owner authentication. No bearer token,
  signed image URL, name, thumbnail or WGS84 device location is sent.
- SDK privacy policy: https://lbs.baidu.com/docs/pcsa?title=compliance/openprivacy
- Official Android SDK and privacy prerequisite:
  https://lbsyun.baidu.com/docs/android?title=androidsdk/guide/create-project/androidstudio
  https://lbsyun.baidu.com/docs/android?title=androidsdk/guide/create-project/attention

## Tests and remaining MVP

`NativeBaiduMapPinsTest` verifies exact coordinate identity, empty ranges,
stale/forged records, duplicate cells, the 64-cell bound and impossible totals.
Existing BD09 Controller tests cover actual Owner and signed Range membership.

Next Android map work is **camera-bounds change -> 500ms idle / one request per
second / one in flight -> signed Go /cells requery**, plus a real full-screen
iOS-style map layout and cluster photo cover, simulated and physical SDK
rendering, accessibility, full-screen and landscape screenshots. The Go Core
already has `OwnerBd09ViewportGate` but a safe Android adapter must preserve
it and not invent provider authorization or a second map data service.

Real-device/production/Android AK acceptance: **跳过（未验收）**, as determined
by the owner; not a source or PR gate. Android code, security and actual CI
requirements remain mandatory.
