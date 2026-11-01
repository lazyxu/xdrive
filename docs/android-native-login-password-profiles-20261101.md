# Android native login profiles / encrypted password recovery

- Keep the existing non-secret server/LAN IP/username login draft and Keystore-encrypted rotating refresh session.
- Add up to 12 verified login profiles scoped to HTTPS origin + optional LAN identity + username.
- Independent opt-in password saving uses another Keystore AES-GCM alias; per-profile AAD binds ciphertext to that exact identity. No password in Compose state/prefs except transient form state and ciphertext.
- Selecting another account clears the in-memory password. Saved password login is a user-invoked action only; no replay loop after revoked refresh.
- Forgetting the selected account clears its encrypted password and only a matching saved refresh; other accounts, photo backup receipts and unrelated routes remain.
- CI Android JVM/Compose/emulator and exact HEAD Final Gate required. Physical-device behavior unverified.
