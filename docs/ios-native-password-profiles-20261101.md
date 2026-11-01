# iOS native per-account login profiles (P1)

- Login drafts remain non-secret and survive invalid password, 5xx and offline attempts.
- Successfully verified Owner/root logins add one canonical HTTPS Server+username profile (maximum 12).
- Optional password retention uses `WhenUnlockedThisDeviceOnly` Keychain **separate** from the rotating refresh token. No password is written to UserDefaults.
- Choosing a different profile clears the password field and stored-session retry intent. Reusing a Keychain password is explicit user action, not an automatic 401 replay.
- Forgetting the selected profile deletes that password and only a matching Keychain refresh record; unrelated accounts and backup ledgers remain.
- Requires real iOS IPA compilation and exact HEAD PR Final Gate. No physical device acceptance claimed.
