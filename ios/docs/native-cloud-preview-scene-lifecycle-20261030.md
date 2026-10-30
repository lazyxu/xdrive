# iOS cloud Gallery full-screen preview scene lifetime

Stacked on #3290, in the native iOS Photos backup/view vertical slice only.
The already-tested #3280 parent is not modified.

The full-screen cloud Viewer previously stopped playback on navigation/Owner
switch, but did not retire its signed AVPlayer preview URL or already-decoded
still while the iOS scene was inactive/backgrounded. This is both a memory
lifetime and privacy/stale-authority problem.

The Viewer now clears still/video state and pauses player on scene
inactive/background, updates an ephemeral request generation token (which
cancels the prior `.task(id:)`), and only re-fetches on an active scene after
fresh native `verifiedAuthorization()` and same-Owner checks. Cancelled or
stale requests cannot publish an old error or image after logout, background
or reactivation. No extra access token cache, upload, signed URL reuse or
background networking was introduced. Live ZIP still reports not playable;
its original storage receipt is not modified.

Test: `desktop/tests/ios-native-cloud-preview-scene-lifecycle.cjs`.
Exact-head macOS IPA, CI/Final Gate and physical iPhone backgrounding/video
cases remain required. Physical acceptance: 跳过（未验收）.
