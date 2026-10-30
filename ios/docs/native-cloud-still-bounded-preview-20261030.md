# iOS cloud still preview: bounded, off-main original decoding

Stacked child of #3280 native Photos/Viewer integration, created while
the parent's exact-head IPA had already succeeded and CI was running.
The parent HEAD is unchanged.

## Problem
An authenticated original image is capped at 32 MiB compressed bytes, but
`UIImage(data:)` can expand a very high-resolution JPEG/HEIC on the SwiftUI
main actor without a corresponding pixel-size cap. This threatens cloud
Gallery Viewer responsiveness and memory on iPhone.

## Change
Reuse the proven ImageIO pattern used for native cloud thumbnail decoding.
Keep the existing Owner-verification, signed same-origin preview ticket,
native bearer exclusion, HTTP cap and video/Live ZIP behavior. Decode
the still on `Task.detached(priority: .utility)` with ImageIO caching disabled,
orientation transform enabled and long edge <=4096px; check cancellation
before returning the result to the native Viewer. No new API, retry,
upload writer, local ID, persistent cache or background task.

This is a **display-resolution cap**, not a change to the stored original,
its CAS SHA-256 or backup receipt. For larger originals full native zoom is
limited to the decoded 4096px rendition in this MVP.

## Validation
`node --test desktop/tests/ios-native-cloud-still-bounded-preview.cjs`
is appended to the existing exact-head iOS unsigned IPA source-contract gate.
It also requires successful macOS iPhoneOS build and applicable CI / Final
Gate on its own HEAD before merging to master. Real iPhone, huge HEIC and
rotation acceptance are 跳过（未验收）.
