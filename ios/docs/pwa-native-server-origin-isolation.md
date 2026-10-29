# iOS Web/PWA origin vs. native Photo backup server

The iOS application intentionally runs two independent authenticated sessions:

- **Shared Files/Gallery PWA:** WKWebView, WebKit's HttpOnly Cookie storage;
  its selected HTTPS origin is now persisted at `xdrive.ios.web.origin`.
- **Native PhotoKit / backup tools:** URLSession and device-only Keychain;
  the native login's last-used origin remains `xdrive.ios.server`.

A native login to a different server must not silently change the WebView host
at the next cold launch. The opposite direction is also isolated: selecting
a new PWA host must not silently rewrite the stored native credential's
server. **This is preference isolation, not single sign-on or Owner parity.**
The user must explicitly authenticate and verify the destination Owner/root
before any native photo upload. Never import native bearer/refresh tokens into
the WebView or copy PWA cookies to URLSession.

## Migration

For an existing installation lacking `xdrive.ios.web.origin`, the shell
migrates a syntactically valid legacy `xdrive.ios.server` once through the
existing HTTPS-only `ServerAddress.parse`. Invalid or missing legacy input
shows the server connection form. Once the dedicated Web key exists, even if
malformed, it never silently falls back to a different native-login server.
Opening a valid PWA server writes **only** the dedicated Web key. The existing
main-frame same-origin and TLS checks remain unchanged.

## Source-level and physical acceptance matrix

| Scenario | Expected outcome |
| --- | --- |
| Old install with valid HTTPS server A; no dedicated Web key | Web opens A; dedicated key is populated once |
| Old install with invalid/HTTP server input | Connection form; no unsafe implicit HTTP navigation |
| PWA opens A; native login explicitly switches to B; cold restart | PWA still opens A; native credentials remain scoped to B |
| PWA explicitly changes to C; native server stays B | PWA opens C; native login is not silently changed |
| Dedicated Web key becomes malformed | Connection form; no fallback to B |
| PWA authenticated as one Owner; native login as another | Neither session is reused; backup requires its own verified Owner/root |
| Web download, isolated map child, external HTTPS link | Existing WebKit origin/download handling unchanged |
| Invalid TLS certificate for IP or DNS host | Reject normally; no certificate bypass |

Run the existing exact-HEAD `iOS Native Unsigned IPA` build and the repository
required PR checks. Physical iPhone, Keychain rotation, two-server LAN/TLS
and cold-restart observations: **跳过（未验收）** until performed. A build or
simulated preference test is not a substitute for physical sign-in evidence.
