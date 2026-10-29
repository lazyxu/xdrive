# iOS: one shared React/MUI UI + a narrow native Photos Host Adapter

## User-visible contract

There is **one** iOS app and **one** normal xDrive UI: the same server-hosted
Web/PWA React/MUI Login, Files, Gallery, Map, Viewer, account menu and Settings.
The new **iPhone 系统相册备份** section is rendered inside the existing
`XDriveSettingsDialog` only when a genuine iOS WKWebView Host Adapter is
present and the PWA has a current Server-verified Owner.

The previous SwiftUI `LoginScreen`, `PhotoBackupMVPScreen`,
`LocalPhotoInventoryScreen` and old standalone native-login Keychain
store have been removed in the consolidated follow-up. Their reusable
PhotoKit/Go UploadSession/ledger core remains the one real backup path.
The small initial HTTPS server picker and connection error recovery
are host bootstrapping, not a second authenticated product UI.
Changing servers is initiated from the canonical React Login/Settings,
not an additional floating native menu.

## Architecture

- `web/src/iosPhotoHostAdapter.ts` implements the typed request/response
  transport for `XDriveIOSPhotoBackupHost`.
- `ui/shared/src/mui/IOSPhotoBackupSettings.tsx` renders the single MUI
  permission/progress/cancel/summary section. No extra React page registry.
- `ios/XDriveIOS/IOSPhotoHostBridge.swift` owns the exact-origin WKScriptMessage
  channel, PhotoKit permissions and foreground backup coordination.
- `ios/XDriveIOS/ForegroundPhotoBackupMVP.swift` stays the sole
  SHA256/encrypted-intent/Go UploadSession/verified Node receipt implementation.
  It is not cloned into TypeScript or a second native uploader.

## Protocol version 1

Only the **HTTPS main frame** of the pinned WebView origin may send
`window.webkit.messageHandlers.xdriveIOSHost.postMessage`:

| Method | Requires verified Web Owner | Side effect |
| --- | --- | --- |
| `capabilities` | No | Read-only protocol negotiation |
| `photos.status` | Yes | Read-only PhotoKit authorization + authorized count |
| `photos.requestAccess` | Yes | Prompt Photos authorization on **user click** |
| `photos.backup.start` | Yes | Native UIKit explicit confirmation, then bounded foreground originals |
| `photos.backup.cancel` | No | Cancel the current foreground task only |
| `host.server.change` | No | Exact-origin shared UI action; host asks before switching servers |

Messages must carry a UUID request id, version 1, exact method and bounded
input. Responses and progress are delivered through matching-id CustomEvents.
Native always checks the actual main-frame security origin, current WebView
origin, real Server `/api/v1/me`, current Owner and root. The Web passes only
its short-lived **in-memory access token Web → native** for each explicit
operation, never a refresh token or browser Cookie; the native side uses an
ephemeral URLSession with normal TLS and no redirects. It does **not** rely
on a self-claimed JavaScript Owner id. It never sends a native Keychain
credential to the WebView, saves the Web token or returns original PhotoKit
IDs, raw file bytes, names or GPS to JavaScript.

If WebKit changes host, the shared Settings closes, the Owner changes,
the user cancels or iOS backgrounds the app, stop the foreground native
task. A lost finalize/create ACK is **not** permission to replay an upload:
retain the sealed intent as uncertain and report that status.

## First MVP: deliberate limits

- Permission can be Full or Limited. The visible count is the authorized
  subset, not the iPhone's full photo library.
- A click scans only the chosen 256-entry window (64 candidates/page)
  and uploads at most 20 ordinary still originals. Repeat scans recheck
  known Node/SHA receipts; PhotoKit offsets are transient and do **not**
  prove permanent all-library coverage.
- iCloud originals are downloaded only after a separate explicit opt-in
  (off by default). No thumbnail substitution.
- Live Photo still+motion pairing, original video backup, background sync,
  photo-only Device SourceRun and automatic mirror deletion are excluded.
- A native confirmation is required before the first write. The success
  summary is the existing Server-receipt-backed count, not a local timer.

## Verification checklist

1. Web/PWA/Android/DSM never render native iPhone settings when no real
   `xdriveIOSHost` handler exists.
2. In iOS WKWebView, the current authenticated PWA Settings shows
   authorization state, a deliberate grant button, 256/20 scope and cancel.
3. Native main-frame origin, same host/port and current Owner/root are
   independently checked before PhotoKit reads and writes. Cross-origin
   subframes, public share and stale Owner requests cannot invoke them.
4. Switching Owner, native server, app background, Settings close or an
   interrupted transfer cancels outstanding native operations and does not
   silently replay unknown writes.
5. Only one ongoing foreground backup; duplicate starts are rejected.
6. Run exact-HEAD iPhoneOS unsigned IPA compilation, Web TypeScript/build,
   security tests and actual required CI before merge.

Physical iPhone + SideStore installation, real iCloud originals, multiple
Owners, LAN cert trust, interrupted POST/finalize, 100k libraries and WebKit
password/Keychain isolation: **跳过（未验收）** until observed on hardware.
Do not equate compilation or a source-level checklist with those tests.
