# iOS native cloud backup-original Viewer — direct system export (2026-11-01)

## What is missing on master

The native backed-up original wall reads 48-slot Owner-root pages and L3 previews stills, videos and validated two-resource Live ZIPs, but the Viewer had no direct download/export control. Navigating separately to native Files management is a poor Photos-first workflow. This patch reuses that *already implemented* verified Files export path rather than creating a new ticket fetch or local upload writer.

## This branch

- Adds **导出原件** to the L3 cloud backup-original Viewer for an exact, currently verified Owner-root file (Node ID, parent ID, name, revision, size) at most 512 MiB. Existing Files export independently re-reads and verifies the same Node **before and after** a same-origin signed download.
- After staging finishes, exposes the native iOS `ShareLink` control **分享或保存原件**; the OS share destination must be selected by the user. No automatic PhotoKit Photos import is claimed. A Live Photo backup remains a verified ZIP, not automatically restored to the iOS Photos library.
- The existing exporter provides download status, cancellation and private temporary-file cleanup. Switching Viewer item, Owner, scene or dismissing Viewer invalidates the old staged file and prevents another Owner or Node revision inheriting it.
- Explicitly labels the existing 512 MiB staged Files-export limit; larger originals require a future dedicated streaming export/restore path.
- Does not touch PhotoKit scans, local Viewer, original backup ledger, CAS, server, credentials, Files exporter implementation or other platform features.

## Source and build gates

The already invoked iOS IPA native source contract `desktop/tests/ios-native-cloud-original-thumbnail-wall.cjs` now covers the Viewer-to-Files exporter bridge and invalidation. The existing `ios-native-files-download-export.cjs` covers the signed ticket / matching Node protocol. Require exact HEAD iOS Native Unsigned IPA, applicable full CI, Final Gate and branch protection before merging this independent Draft PR.

Real iPhone export to Files, photo share destinations, large video/Live ZIP and Owner-switch tests remain **跳过（未验收）**. Separate required P0: native **Save to Photos** for still/video/Live resources, unified PhotoAsset export/restore and app-level all-photos timeline.