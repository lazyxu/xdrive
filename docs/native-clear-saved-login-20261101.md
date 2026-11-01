# Native iOS/Android signed-out saved-login cleanup
This follow-up builds on PR #3410's native session retry head; parent PR HEAD is not modified.

## Behavior
- On a *signed-out* native login form, expose confirmation to delete this device's stored refresh credential and saved nonsecret Server/domain, LAN IPv4 and username hints. Active Owners must first use the existing guarded logout, not this shortcut.
- Native Keychain v2 / Android encrypted Android Keystore credential must be cleared **before** nonsecret drafts. If secure removal fails, leave the visible server/username hints intact and report failure. iOS deletes both new and legacy login draft preference keys; Android commits all current/fallback preference removals atomically, including only the selected Server's saved route.
- Cancel iOS foreground photo scheduling before cleanup, while Android session deletion already revokes WorkManager backup authorization. Neither action deletes photo originals, backed-up files, or upload uncertainty journals.
- This action is **local login cleanup**. Since there is no confirmed remote logout in an unauthenticated/offline form, do not imply server-side token revocation; the remote session may remain valid until expiry.
- Do not save passwords, copy browser Cookie tokens, bypass HTTPS/TLS, auto-retry refresh POSTs or change Owner identity validation.

## Required gates
Android unit tests cover offline-restored session removal, a failing secure credential deletion and active-Owner refusal; native source contracts cover Keychain-first ordering and fallback keys. Exact-head Android native/Compose CI, unsigned iOS IPA, complete CI and Final Gate required. Real-device acceptance remains unverified (nonblocking per user policy).

Stacked Draft only. Do not merge into master until parent #3410 is validated and merged; then retarget/revalidate this precise change on master.
