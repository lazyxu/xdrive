# Native saved-session recovery after transient login failures

This follow-up builds on merged PR #3384. It **does not** change the stored password, refresh-token format, HTTPS identity validation or authenticated Owner/root checks.

- iOS: an initial Keychain refresh/Owner verification is attempted only once per launch. After a transient network, HTTP 429, or 5xx failure, the signed-out screen offers **重试恢复已保存的登录**. A tap re-reads the exact Keychain credential and repeats full Owner/root verification. 401/403, invalid TLS, malformed Keychain entries and Owner/root mismatch do not offer this retry; explicit login supersedes the retry intent.
- Android: the already-existing `restoreSession()` is exposed as an explicit retry only if the original saved session failed transiently, the stored token remains, and no newer server/username draft supersedes the previous Owner. Editing a visible login field hides the retry action, as does manual login. 401/403 revocation clears the stored credential and does not show the action. TLS identity failures and malformed replies cannot create a retry offer.
- Neither platform automatically loops refresh POSTs or submits the typed password again. A refresh that rotated server-side before a lost ACK may still require manual login after a subsequent definitive rejection; do not claim guaranteed password-free recovery.
- DSM continues its deliberate reload after every submitted Agent login whose Owner commit is uncertain, and Browser/PWA retains HttpOnly Cookie isolation. No cross-Owner or cross-Origin credential migration.

## Verification
- `node --test desktop/tests/native-login-draft-resilience.cjs`
- `android :app:testDebugUnitTest` including explicit retry, revoked token and newer-draft fixtures
- iOS Native Unsigned IPA compile and the repository's applicable PR workflows, exact HEAD/Final Gate
- Physical iPhone/Android offline→online and TLS/Owner-change acceptance remain unverified (not a merge gate).
