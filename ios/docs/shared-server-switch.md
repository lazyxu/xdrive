# iOS server switching from the one shared UI

## Before

The iOS WKWebView container still displayed a floating native `...` menu
containing **更换服务器**, separate from the canonical React/MUI account
settings. That extra native affordance contradicted the single-UI decision.
Simply deleting the menu would strand an iPhone on a reachable-but-wrong
server's login page.

## After

- The **shared React login page** shows **更换 iPhone App 服务器** only when
  the actual `xdriveIOSHost` message handler is installed. It works without
  an Owner token, since switching the app's selected server is a host-level
  bootstrap action.
- The **shared React account settings** shows the same action in its iPhone
  Photos section. It is disabled while a foreground backup runs.
- `host.server.change` is a version-1, exact main-frame-origin-checked
  native host command. It does **not** accept a caller-provided new URL,
  authorize an upload or return credential material.
- The native host opens its existing `confirmationDialog` explaining that
  pending WebKit transfers may be stopped. The existing, system-trusted
  HTTPS-only bootstrap picker is shown **only after explicit confirmation**.
- The old floating native `Menu` is removed; no new SwiftUI product page
  or duplicate login is created. The same React/MUI Login/Files/Gallery/
  Viewer/Settings remain the sole visible authenticated xDrive UI.

## Boundaries and verification

1. Regular Safari/Chrome/mobile PWA, DSM and Desktop never receive a fake
   iOS native button; without a real bridge only their existing Web settings
   and connection controls remain.
2. On iOS with a working server, the button is available before login and
   from signed-in Settings. It does not require a second Keychain login.
3. On press, only the exact pinned HTTPS **main-frame** WebKit origin may
   invoke the native command; a child frame, HTTP target, cross-origin
   navigation and an arbitrary script message name are rejected.
4. A running PhotoKit backup prevents the switch; native confirmed departure
   dismantles WKWebView and cancels obsolete disposable downloads / native
   tasks rather than inheriting an older Owner.
5. Canceling the confirmation keeps the existing WebView and preserves the
   current Server/Owner selection. A new URL is validated by
   `ServerAddress.parse`; redirect and invalid certificate bypasses stay
   prohibited.
6. The PWA selected origin remains in `xdrive.ios.web.origin`, isolated
   from the obsolete native account's `xdrive.ios.server`.

This is a stacked migration PR based on #3116's unchanged CI-tested
source HEAD. It does not modify #3116, #3117 or the in-progress #3075/#3107
branches. After #3116 merges, retarget this PR to master and require its
own exact-HEAD iPhoneOS IPA build plus applicable Web checks.

Physical SideStore/iPhone network switching, TLS CA installations, transfer
cancellation and Owner-change tests are **跳过（未验收）**, distinct from
source-level checks.
