# iOS Native login: one-PR compact UI, 16 decisions (2026-11-15)

Scope: **presentation only**, 16 user-authorized simplifications in one PR.
No changes to verified Owner/session, Caddy pinned root/IP SAN, Keychain namespace,
password or refresh-token lifecycle, automatic PhotoKit backup, or PWA cookies.

## Default signed-out view

One `xDrive` navigation title. Four essential controls: HTTPS Server address,
username, password with show/hide button, and a single primary Login action.
If an account profile exists, show a small "已保存的账号" menu near the Server field.
Seven optional disclosure/diagnostic states start **closed** on each view mount.

## Decisions 01–16

| # | Previous visible element | Implemented compact presentation |
|---|---|---|
| 01 | Navigation title + brand image/title | One navigation title |
| 02 | Native-client subtitle | Removed |
| 03 | Personal-cloud tagline | Removed |
| 04 | Private IP | Advanced Connection disclosure, default closed |
| 05 | Long routing policy | Nested Advanced help, default closed |
| 06 | Caddy trust/rotation instructions | Same nested help, on demand |
| 07 | Pair/update CA button | Advanced Connection, show quick entry for TLS errors |
| 08 | Password-save toggle | Login Preferences disclosure, explicit Keychain opt-out |
| 09 | Keep-signed-in toggle | Login Preferences disclosure, retains default true |
| 10 | Separate sign-in-with-saved-password | One Login button using exact current profile if text password empty |
| 11 | Always-visible destructive Forget | Only inside Saved Profiles menu, original confirm and Owner scope |
| 12 | PWA Cookie diagnostic footnote | Removed from default view |
| 13 | Version + source SHA | About disclosure; additionally available/copyable on expanded errors |
| 14 | Emergency photo backup stop | Help & Emergency disclosure; still works signed-out/offline |
| 15 | Long error/notice strings | Short summary, opt-in full diagnostics and post-pairing details |
| 16 | Stored-session restoration retry | Only within failed-login feedback, under original transient retry policy |

## Preserved safety and behavior

- **Password save** and **keep-signed-in** remain independent.
  Turning off password storage calls `setRememberPasswordFromUser(false)`,
  which removes only the selected profile's Keychain password before showing OFF.
- The Login button prefers a manually typed password. Only when the text field
  is empty and a stored credential exists for this exact Server, private-IP route
  and username does an explicit tap invoke `signInWithSavedPassword()`.
  No background password replay or auto-login is added.
- Certificate pairing is still the same pre-auth user-initiated operation,
  with strict pinned CA/IP SAN; failures can open the Advanced section directly.
  No HTTP fallback for TLS identity failures.
- Logout/forget retains confirmation and original Server/username/Owner fences.
  Forgotten passwords or refresh credentials for other profiles are untouched.
- Emergency stop remains accessible without an authenticated Server/Owner and
  calls the same local auto-schedule stop, pending BG cancellation, and credential
  revoke flow. It does not attempt a login or upload.
- Detailed messages and build SHA are copyable only following an explicit
  diagnostic action. Bounded diagnostic text is constructed exclusively from
  the sanitized model error and build label: no password, bearer token, URL
  body or arbitrary Security exception text.

## Test and merge gate

- `desktop/tests/ios-native-login-compact-16-items.cjs` explicitly covers all
  16 decisions and the security/fallback invariants.
- `XDriveIOSCompactLoginUITests.swift` runs four real SwiftUI UI journeys in
  an ephemeral iPhone Simulator: default collapsed view, Advanced/TLS help,
  Login Preferences + About, and signed-out Help/Emergency entry. The CI-only
  launch flag uses `safeStartup: true`: no fake Owner, remote sign-in,
  password/refresh-token read, TLS pairing or emergency stop.
- Existing password-prefill, owner failure/retry, LAN trust and startup tests
  are not removed or disabled. Applicable exact-HEAD iOS Simulator, IPA,
  full CI/Final Gate must pass before merging.
- Physical signed iPhone and actual Owner/LAN credentials: **跳过（未验收）**
  until real user installation; Simulator green is not on-device acceptance.
