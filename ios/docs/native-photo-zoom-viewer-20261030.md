# Native Photos local/cloud still viewing — pinch and double tap

Independent, stacked iOS-only improvement for the viewing half of the native
PhotoKit automatic-backup MVP. Parent: #3274 at `0d94895558bcf8b321f84ac444c6c5cfa9587d5d`. No parent
HEAD or already-running parent CI was changed.

- One native `UIViewRepresentable` using `UIScrollView`, allowing pinch/pan
  at 1–5×, double-tap zoom to 3× and double-tap again to reset.
- Applied only to local still and Owner-authorized cloud still previews;
  native videos and Live Photo remain on their existing AVPlayer/
  PHLivePhotoView paths.
- Image identity changes reset zoom. Cloud Owner switch still dismisses the
  preview; PhotoKit permission and dismissal still clear local media.
- Zoom UI never owns authentication, PhotoKit, uploads or any network request.

### Gate
New source check:
`node --test desktop/tests/ios-native-photo-zoom-viewer.cjs`.
Must be compiled on macOS as an unsigned iOS device IPA, and pass exact-HEAD
applicable PR CI/Final Gate before merging to master. Current stacked branch
has no verified IPA. Physical touch/rotation/VoiceOver: 跳过（未验收）.
