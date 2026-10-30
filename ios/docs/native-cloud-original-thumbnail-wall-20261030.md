# iOS native cloud Originals thumbnail wall (independent viewing follow-up)

Parent: **#3268** immutable, already-tested native Photos MVP source.
This branch does not change the in-progress #3270 (uncertain receipt recovery)
and modifies only the cloud original viewing surface and its source contract.

## Goal

The first native cloud original viewer showed only filenames. Make the visible
Owner-root backup originals usable as a **native photo/video grid** without
creating new Go API routes, downloading full-resolution original files for each
thumbnail, or cloning the Web Gallery's controller.

- Scan exactly 48 entries of the current Owner root per page, continuing the
  preexisting independently verified account scope.
- Keep the existing server-derived filename/revision checks and \`-xios-\`
  namespace filter. Server \`/api/v1/media/items/:nodeID/thumbnail\` is used
  with the Node revision and native Bearer header, not a token in a URL.
- Load only SwiftUI-visible tiles; releasing a cell cancels the view-bound
  async operation. Thumbnail 404/503 remains a **placeholder**, not evidence
  of a missing or unbacked-up original.
- Limit each thumbnail to 2 MiB and downsample through ImageIO to <=280px
  off the main actor. Do not use the whole original as a thumbnail fallback.
- The in-memory reader is valid only for one freshly verified native Owner
  page generation. Clear on reload/logout/navigation and reject stale replies.
- Tap the tile to open the existing authenticated still/video preview or
  accurate Live Photo ZIP placeholder. No remote edits or duplicate uploader.

## Not implemented

This is a **first useful native backup-original wall**, not the complete
Server PhotoAsset Gallery index: album navigation, search, historical pages
beyond the Owner root, cloud Live ZIP unpack/playback and physical iPhone
acceptance remain separate. Live ZIP remains a file until an independently
verified, bounded parser and motion pairing is implemented.

## Verification

Must validate this branch on an exact macOS IPA build and suitable full CI /
Final Gate before any master merge. The new contract is
\`desktop/tests/ios-native-cloud-original-thumbnail-wall.cjs\`.
The parent #3268 tests and PR head must not be rewritten.
