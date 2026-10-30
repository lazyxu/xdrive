# iOS local PhotoKit fullscreen Viewer: permission and background fence

Stacked iOS Photos child #3290; #3280's tested/running HEAD remains unchanged.

## Source issue
The whole-library/album 64-item scanner is deliberately suspended while a
full-screen Viewer covers the wall. The detail's existing PhotoKit permission
checks only executed at initial load or inside asynchronous image callbacks;
a PhotoKit library mutation or a scene background transition after a still,
Live Photo or AVPlayer had already appeared did not independently clear it.

## Fix
The native full-screen detail installs a scoped
`PHPhotoLibraryChangeObserver` while visible, revoking the current media and
dismissing the detail on any PhotoKit library change. On iOS scene
inactive/background, `model.cancel()` pauses playback, invalidates outstanding
PhotoKit callbacks and clears still/Live/video buffers before the app can
continue displaying them. On foreground return, load only after a current
Full/Limited permission recheck, and independently re-resolve the selected
PhotoKit ID within that authorized subset. If permission is unavailable, close
the viewer rather than displaying stale media.

No local PhotoKit IDs are persisted or passed to the Server; this does not
change the upload/ledger/automatic schedule, cloud Owner preview or Web UI.

## Validation
`node --test desktop/tests/ios-native-photo-detail-permission-fence.cjs`
is added to the existing iOS unsigned IPA source-contract step. New HEAD needs
independent macOS unsigned device IPA compilation and applicable CI/Final
Gate before master merge. Real PhotoKit Limited picker, permission revocation
during video/Live playback and app-switcher snapshots are
**跳过（未验收）** until exercised on a physical iPhone.
