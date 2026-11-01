# iOS native login verification diagnostics — 2026-11-01

## Symptom and reproducible defect
An iPhone native xDrive login showed `无法验证当前服务器、账户或云端根目录；未建立原生会话。` with a saved HTTPS domain, optional private LAN IP, remembered username, and an empty password field. The exact text comes from `NativeOwnerLoginModel.humanMessage`'s final fallback.

On master `b5eaf321`, that function recognizes only local Keychain errors and `AuthFailure`. It does **not** recognize `URLError` or `XDriveNativeOwnerRootFailure`. A standalone Swift fault-injection reproduction compiled locally with Swift 6.2 returned that identical generic string for 7/7 distinct failures: untrusted TLS certificate, timeout, connection refused, missing Server installation ID, Owner mismatch, invalid root reply, and Owner/root HTTP 403.

## What this PR changes
- A narrow, pure Swift Foundation policy classifies TLS/network, native Keychain, malformed/missing Server identity, Owner drift, HTTP 401/403/404, and transient 429/5xx. No raw response, credential, token, Keychain value or request URL enters UI.
- LAN certificate guidance mentions verified IP SAN and trusted CA; no TLS exceptions or post-login origin switching.
- The existing explicit Keychain restore retry is still bound to the exact visible domain/LAN IP/username, user click, and reverified Owner. New handling makes Owner verification **429/5xx** retryable too, but not 401/403, malformed /me, TLS or mismatch.
- Added an actual Swift executable with 14 injected error cases to the existing iOS IPA CI workflow; extended the existing native Owner source contract. No changes to Go API, backup Runner, map, gallery or other platforms.

## What remains unknown
The screenshot itself cannot distinguish a failed *automatic Keychain restore* from a newly submitted manual login, nor prove which TLS/Server response was received. Empty password plus the existing 'manual failure keeps password' behavior suggests a startup restore. Without iPhone device logs or authenticated, sanitized Server responses, a real private-Server reproduction is not possible. Sandbox anonymous HTTPS GET `/api/v1/version` was attempted but the sandbox cannot resolve the user's domain; this is **not evidence** that the user's network cannot resolve it. No device credentials were requested or used.

## Related work and validation
#3328 defines LAN-first and fail-closed TLS behavior; #3063 introduced Owner+Root verification; #3384 retains login drafts; #3410 recently merged an explicit Keychain restore retry; #3424 is a separate in-flight native credential deletion PR with some overlap in `NativeOwnerLoginModel.swift`. Do not alter #3424's running HEAD. Validate this PR's exact HEAD and coordinate conflict-free merging/revalidation with #3424, observing the repository's full CI/Final Gate rules. Unsigned IPA compilation does not by itself prove success on the user's physical iPhone.
