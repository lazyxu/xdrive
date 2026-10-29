# iOS shared Settings: bounded photo scan windows

## Why this migration exists

The initial [#3097](https://github.com/lazyxu/xdrive/pull/3097) native
foreground still-photo backup only scans the newest 256 authorized PhotoKit
items in a user-triggered run. Repeating that window cannot reach older
photos in a large iPhone library.

[#3107](https://github.com/lazyxu/xdrive/pull/3107) originally added the
correct bounded scan engine, but also added a SwiftUI Stepper to the old
Photos backup page. The user has explicitly retired the second SwiftUI
account/Photos UI. This PR **ports only the reusable scanning logic**, and
moves the window picker into the canonical React/MUI Settings, using the
existing iOS Host Adapter and its exact Owner-verified upload path.

## Architecture and behavior

- `XDrivePhotoBackupScanWindow` is a pure, Foundation-only window math
  helper: 256 entries per window; no overflow for `Int.max`; out-of-range
  windows have capacity **zero** and never jump back to the first window.
- `XDrivePhotoKitBoundedSnapshotScanner.start(atOffset:)` selects a
  transient slice of the current lazy PhotoKit `PHFetchResult`. It reads
  64 metadata candidates at a time, never an entire library into a Swift
  array; authorization and PHChange invalidate the snapshot mid-scan.
- `XDriveIOSForegroundPhotoBackupMVP.run(...,startOffset:)` continues to
  upload **at most 20 new ordinary still originals per click**, through
  exactly the existing encrypted intent / Go UploadSession / CAS + Owner
  Node receipt and no second writer. Live Photo and videos remain excluded.
- The shared `XDriveIOSPhotoBackupSettings` shows **previous/next and a
  numbered window selector**. It uses the current authenticated Owner and
  current authorized asset count; the selected window is held only in the
  mounted React UI, not persisted as an asset identity.
- `IOSPhotoHostBridge` accepts an integer `windowIndex` **only for an
  explicit `photos.backup.start` call**, checks it is not a Boolean,
  fractional, negative or overflowing value, converts to an offset with the
  same helper and re-verifies current Owner/root before any bytes.
- Capabilities extend the existing v1 bridge with `scanWindows: true`.
  **Older installed IPA builds do not advertise this**; shared UI hides the
  window selector and keeps first-window behavior instead of pretending
  a new Web page alone upgraded native backup functionality.
- The iOS system upload confirmation includes the chosen window start.
  Progress includes `startOffset`, current window capacity, actual
  Uploaded/Verified/Unavailable/NeedsReview counts; no percentage or total
  that claims the entire device was backed up.
- A library change between runs can reorder date-based offsets. A selected
  window that is now past the authorized count must return empty with an
  explanation and **never silently fall back to the first 256**. The ledger's
  exact original SHA and Server Node receipt remain the only durable proofs.

## Acceptance / CI

The iOS unsigned IPA workflow runs the same pure-window checks used by
#3107 before building on a macOS runner. Targeted cases: 0, 1, 256, 257,
512 and 600 assets; first/middle/final window capacity; invalid offsets;
authorization shrink; `Int.max` arithmetic. Reuse all #3097 tests rather
than inventing a second UploadSession implementation.

Real device Photos Full/Limited, iCloud originals, ACK-loss, same-asset
original edits, physical 100k, SideStore and VoiceOver: **跳过（未验收）**
pending actual evidence. Code tests and IPA compile do not prove physical
library coverage or automatic background synchronization.

## Merge strategy

- This is part of the **single consolidated** follow-up PR #3123, directly
  stacked on #3116. The finished but untested #3117 legacy-screen retirement
  and #3118 shared server switch were folded into the same one-commit
  integration tree to avoid three separate full CI queues. The parent's
  already-running checked HEAD is not changed.
- The old #3107 branch remains a source reference, not an additional
  PR to merge with its obsolete `LoginViewModel.swift` or
  `PhotoBackupMVPScreen.swift` edits. Those duplicate SwiftUI files are
  removed by the consolidated follow-up.
- After the shared host base is stable, retarget to `master`, test the
  exact ported SHA, and close #3107 as superseded **only when equivalent
  scanning behavior and tests are demonstrably merged**.
