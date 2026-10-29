# xDrive all-platform UI architecture and capability boundaries

**Decision (2026-10-29): One product, one React workspace for browser-based Hosts, explicit native feature modules.** This document extends [the Desktop/DSM Host migration](./xdrive-shared-app-host.md). It is a migration contract, **not** a claim that all clients already mount one application or that unverified native features work.

## What is actually shared today

| Client | Runtime / UI | Canonical code | Remaining migration |
| --- | --- | --- | --- |
| PC Web and Mobile Web | React/MUI responsive browser app | `web/src/App.tsx`, `WebFileExplorer.tsx`, `MobileFiles.tsx`, shared MUI Gallery/Viewer | Still a Web-specific top-level app; migrate its route/controller composition into `XDriveApp` without losing Hash deep-links |
| Browser PWA | The same Web/Compact React app | Web + `web/src/pwaRuntime.ts` and Service Worker | Keep its offline, install, update, cross-window Owner and upload safety behavior |
| iOS Web IPA | SwiftUI shell hosting origin-locked WKWebView | `ios/XDriveIOS/XDriveWebAppHome.swift` + live Web UI | Native PhotoKit interface and a secure Web/native Host bridge; do not create a second Files/Gallery in SwiftUI |
| Electron Desktop | React/MUI + preload/Agent | `ui/shared/src/mui/XDriveApp.tsx` and `desktop/src/renderer/App.tsx` | Full Desktop Files controller is still large; keep native actions in the owning Host |
| Synology DSM | Shared React app + authenticated CGI/owning Agent | `web/src/synology.tsx`, `synologyHost.ts`, `XDriveApp` | Fill *real* Owner-authorized domain ports; missing native actions must stay unavailable |
| Android APK | Kotlin/Jetpack Compose native (not a WebView) | `android/app/src/main/java/com/tfluid/xdrive/` | Native UI parity by generated tokens, behavior/API contracts and screenshot tests; independent native SDK bridges |
| iOS native capabilities | SwiftUI/PhotoKit/Keychain | `ios/XDriveIOS/` | Owner-bound photos, incremental foreground backup and optional background work: real SDK implementation only |

## Ownership layers

1. **Product contracts:** API schemas, Owner/Root semantics, page/navigation IDs, media and upload receipt identity, UI tokens/gesture/accessibility contracts. React and native UI must agree.
2. **Shared React domain/controllers:** Files, Gallery/Map/Viewer, tasks, device backups, settings, Storage. Do not fork business state by Host; Wide/Compact is a viewport presentation, not a separate privileged product.
3. **Platform feature modules:** LocalBackup (ordinary local Folder Push), VirtualDrive (CfAPI/FUSE mount), NAS Package/Photos Push, NativePhotoBackup (PhotoKit/MediaStore), Offline PWA, Desktop lifecycle. Features can share UI but only their owning platform implements privileged operations.
4. **Host adapters:** Browser HTTP, PWA runtime, Electron preload/Agent IPC, DSM authenticated CGI, WKWebView Native Bridge, Android native SDK. Ports must be typed and allowlisted, not generic Agent RPC. Existence of a UI route is not evidence an operation is available.
5. **Server/Agent authority:** Every write validates current Owner/Root/device credential/revision. UI gating is defense-in-depth only; never forward secrets, raw local absolute paths or foreign device controls through Web page props.

## Non-negotiable Desktop distinction

**Local-folder Push backup != cloud virtual drive mapping.**

- **LocalBackupFeature:** authorized ordinary OS folder -> bounded scan/difference -> durable upload to existing Owner destination; Backup by default, Mirror explicit. Owning Agent controls Root, schedule, pause/retry and trustworthy task receipts. Web/foreign Desktop can see *redacted* device/historical status, not command another device's local Root.
- **VirtualDriveFeature:** Windows CfAPI sync root / placeholders / hydration / pinned cache; Linux FUSE mount / per-open backing storage / flush. Desktop Host owns mount paths, native drag/open, service lifecycle and cache policy. Browser/DSM/phones cannot claim such a mapped local cloud volume.
- **Tasks/Viewer/Files:** may present both under the *same* React shell, but neither backend's cancellation/lifecycle should be driven by page unmount, navigation or preview abort.

Other exclusive modules: DSM suite status and authenticated NAS Push; iOS PhotoKit/Keychain and original Live pairs; Android MediaStore/SAF/Media3 and foreground service; Web PWA Service Worker/offline. No fake function success or privilege promotion from OS/admin labels.

## Files migration order

1. Keep `ui/shared/src/file-explorer-controller.ts` the source for verified selection, 100k/virtual pagination, path navigation, current Owner and operation planning. Put **pure** shared admission/presentation policies in `ui/shared/src/`, never in a Browser or Electron shim.
2. Web Wide/Compact now call `xDriveFileExplorerSelectionAdmissionReason` to keep 200 mutation, 500 tag and 1000 Browser download selection rules consistent across both presentations. Desktop's advanced archive/folder downloads still require its *additional, real Host-specific* capability gates and currently retain their own wrapper until Files migration is safe.
3. After in-flight Desktop availability/navigation PRs finish, move the remaining `DesktopFileExplorer` stateful lifecycle into a common Host-neutral Files controller and keep `DesktopFileExplorerHostPort` for typed read/media/write/native actions. The DSM Owner CGI bridge remains strictly Owner scoped and may have fewer mutating capabilities.
4. Migrate the existing Web top-level workspace to the shared `XDriveApp` outlet only after its Browser routes, Hash deep-links, PWA disposal, native bridge and Viewer return anchors are maintained. Do not instantiate a second `XDriveApp` on top of the old Web app.
5. Android native Compose and iOS native SDK views continue matching the same interaction specs, not reimplementing an entire React page tree.

## Acceptance and concurrent PR policy

Every PR must preserve real Host feature availability, authorized Owner/Root, current session identity, offscreen/unmounted GET cancellation, durable mutation completion and accurate failure feedback. Run the affected exact-HEAD TS/React and native tests; add 375/390/899/900px, light/dark, touch/keyboard/accessibility and critical Viewer/transfer re-entry regressions as appropriate.

Parallel PRs may touch non-overlapping files/interfaces. Do **not** modify a queued/running successful HEAD just to sync a moving `master`; fix real failures and respect protected branch checks. Merge complete compatible code with existing valid checks where platform policy allows. Delete branches only after exact-tip merged/superseded evidence; protect open stacked PR head/base. Production device validation may be **跳过（未验收）** at user direction and is not a source/CI gate; it must never be claimed green without evidence.
