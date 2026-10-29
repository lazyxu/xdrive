# xDrive all-platform UI architecture and capability boundaries

**Decision (2026-10-29): One product, one React workspace for browser-based Hosts, explicit native feature modules.** This document extends [the Desktop/DSM Host migration](./xdrive-shared-app-host.md). It is a migration contract, **not** a claim that all clients already mount one application or that unverified native features work.

## Implementation status in master (source checked 2026-10-29)

This records **actual runtime composition, not complete feature parity**.
An unmerged PR, a compiled optional Host variant, an uploaded Artifact and a
physical-device acceptance result are different states.

| Boundary | Canonical code already in master | Implementation status / next gap |
| --- | --- | --- |
| Routes and Host contract | `ui/shared/src/mui/WorkspaceRoute.ts`, `WorkspaceNavigationState.ts`, `WorkspaceHostAdapter.ts` | Desktop/DSM share route vocabulary, same-route lifecycle and Server-verified administrator gating. A visible route alone never grants Owner/Agent permissions. |
| Desktop React application | `desktop/src/renderer/App.tsx` mounts `ui/shared/src/mui/XDriveApp.tsx` | Shared sidebar and page outlet; the large Desktop Files controller and OS integrations still have Host-specific lifecycle and methods. |
| Synology DSM React application | `web/src/synology.tsx` mounts that same `XDriveApp` through `web/src/synologyHost.ts` | Authenticated, explicitly scoped Owner Files read and Gallery/backup/diagnostics ports; many writes and advanced native actions remain unavailable. |
| Browser Web / Mobile Web / PWA | `web/src/main.tsx` mounts `web/src/App.tsx`; it uses shared `XDriveWorkspaceFrame`, `WorkspaceSidebar`, Files, Gallery and Viewer | **Web still has its own top-level app controller; it does NOT yet mount `XDriveApp`.** Preserve hash deep links, Service Worker/offline, current Owner and viewer-return state when migrating. |
| Browser route adaptation | `ui/shared/src/web-workspace-route.ts` maps Web route IDs to the canonical Workspace route registry | Page keys converge while Viewer/browser-only hashes and task scope remain independent and explicit. |
| Files domain | Shared `file-explorer-controller.ts`, `file-explorer-selection-admission.ts`, `file-explorer-host-availability.ts`, `file-explorer-read-identity.ts`, `file-explorer-preview-request.ts` | Bounded read plans/selection/preview semantics share code; Web and Desktop full stateful controller components are still separate. |
| iOS application | `ios/XDriveIOS/XDriveWebAppHome.swift` hosts the same Web/PWA UI in `WKWebView` with a dedicated PhotoKit bridge | No second native Login/Files/Gallery UI. Do not infer always-on background backup or full Live original recovery from the existence of a settings control or a draft PR. |
| Android application | `android/app/src/main/java/com/tfluid/xdrive/MainActivity.kt` uses Kotlin/Jetpack Compose; `android/scripts/shared-ui.mjs` derives visual assets | Native app uses the same Server/domain contract, not React JSX or a WebView replica. Functional and physical UI parity remains a measured target, not a completed migration. |

### One product with real Host-owned native capabilities

```text
                Shared Server API + Owner/Device/Root/Node contracts
                                       |
                ui/shared: domain, React page, routes and tokens
                           /                              \
       Shared React presentation                      Native UI contract
             /           \                             Android Compose
 Desktop + DSM XDriveApp   Web/Mobile/PWA App
                           |
                     iOS WKWebView
                           |
           Typed, verified Host adapters / native bridges
         Electron Agent IPC | DSM CGI | Browser HTTP/PWA |
                     iOS PhotoKit | Android SAF
                           |
                  Existing Server + owning Agent
                         UploadSession/CAS
```

**One rendering technology is not a prerequisite for product parity.** Android
is intentionally native Compose, and iOS renders Web React through a real
WKWebView. Share identities, routes, behavior, design contracts and test evidence,
not fake native methods or another Server/CAS writer. Browser Web does not
become fully migrated merely by importing shared MUI sidebar components.

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

## Shared responsive frame landing (2026-10-29)

`XDriveWorkspaceFrame` now owns **one responsive layout/composition order** for the Desktop/DSM `XDriveApp` and the existing Web/PWA app. Web contributes its original user-gesture upload-resume input through an invisible leading slot, the canonical sidebar, and its current page controller as content. The Viewer overlay, compact header, browser hashes, authentication and Service Worker remain in their owning Host. No additional React root or nested shell is introduced.

Web sidebar actions now also use `xDriveWorkspaceNavigationAllowed` with the Server-verified profile role; backend authorization remains mandatory. This is **frame convergence, not full Web-to-XDriveApp controller convergence**: `web/src/App.tsx` still owns URL/hash and Viewer return state, PWA offline and Owner-scoped transfer lifecycle. Extract those incrementally behind typed Host/data ports. Android stays native Compose with shared visual and behavior contracts.

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
2. Web Wide/Compact **and Desktop** now use `xDriveFileExplorerSelectionAdmissionReason` and `xDriveFileExplorerSelectionRequest` for current-selection/revision checks and 200-mutation/500-tag limits. Browser download selection is additionally capped at 1000; Desktop retains its own authenticated Agent archive/folder 1000-item capabilities. Both Hosts share the pure `xDriveFileExplorerProjectSearchSources`, `xDriveFileExplorerReadNodeID` and `xDriveFileExplorerPreviewRequest` without moving platform IO into domain policy.
3. Bounded Host availability reads and the canonical Desktop/DSM navigation have already merged. **Next:** extract remaining `DesktopFileExplorer`/`WebFileExplorer` stateful lifecycle into common Host-neutral hooks, retaining `DesktopFileExplorerHostPort` for Electron read/media/write/native methods. The DSM Owner CGI bridge remains strictly Owner scoped and may have fewer mutating capabilities.
4. Migrate the existing Web top-level workspace to the shared `XDriveApp` outlet only after its Browser routes, Hash deep-links, PWA disposal, native bridge and Viewer return anchors are maintained. Do not instantiate a second `XDriveApp` on top of the old Web app.
5. Android native Compose and iOS native SDK views continue matching the same interaction specs, not reimplementing an entire React page tree.

## Acceptance and concurrent PR policy

Every PR must preserve real Host feature availability, authorized Owner/Root, current session identity, offscreen/unmounted GET cancellation, durable mutation completion and accurate failure feedback. Run the affected exact-HEAD TS/React and native tests; add 375/390/899/900px, light/dark, touch/keyboard/accessibility and critical Viewer/transfer re-entry regressions as appropriate.

Parallel PRs may touch non-overlapping files/interfaces. Do **not** modify a queued/running successful HEAD just to sync a moving `master`; fix real failures and respect protected branch checks. Merge complete compatible code with existing valid checks where platform policy allows. Delete branches only after exact-tip merged/superseded evidence; protect open stacked PR head/base. Production device validation may be **跳过（未验收）** at user direction and is not a source/CI gate; it must never be claimed green without evidence.

## Migration acceptance gates and executable checks

1. **One React app entry for each browser Host:** move Web's remaining page and navigation composition into the existing `XDriveApp` without stacking another shell on top. Preserve Desktop/DSM outlet state, PWA offline and Service Worker lifecycle, browser hash deep links, mobile 52px header and Viewer return anchors.
2. **Common Files state controller:** converge Web and Desktop navigation, pagination, search, Preview, current Owner and durable-operation receipts, while preserving authenticated Desktop Agent ports and DSM's explicit read-only/missing-feature behavior. Test 10k/100k virtual collections and stale Owner/revision cancellation.
3. **Gallery/Map/Viewer parity:** same signed Owner/Album/Node and BD-09 cell-to-photo-wall-to-Viewer behavior for both Browser map SDK Hosts, Desktop and iOS WKWebView; do not resurrect the removed fixed bottom photo strip or allow an unscoped map fallback.
4. **Android native parity:** use the generated shared visual contract and common API behavior. Validate 375/390/899/900px equivalents, dark/light, portrait/landscape, touch/keyboard/VoiceOver/TalkBack, native Back/return anchors and genuine capability availability. Pixel-perfect 1:1 is not proven by code reuse or a green default APK alone.
5. **Durable native operations:** Windows CfAPI/Linux FUSE mount, local-folder Push, NAS package, iOS PhotoKit and Android MediaStore/SAF have distinct owning Host/Agent modules. A page unmount cancels obsolete reads, never an already accepted durable backup, UploadSession or native mount.

Run the structural regression without credentials or physical devices:

```sh
node --test desktop/tests/all-platform-ui-architecture-contract.cjs
npm run typecheck --prefix desktop
npm run build --prefix web
npm run build:synology --prefix web
node android/scripts/shared-ui.mjs --check
```

Continue affected security/Owner tests and exact-HEAD required CI for implementation
PRs. Inaccessible physical production tests can be **跳过（未验收）** by user
decision; source-level authorization, compilation, transport integrity and
platform permission checks cannot be marked passed by a skip.
