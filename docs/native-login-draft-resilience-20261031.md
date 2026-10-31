# Native login draft resilience (2026-10-31)

Scope: native iOS/Android login input persistence only. No new password vault, no change to rotating refresh tokens, Owner enrollment, background backup grants, HTTPS verification, or post-login LAN switching.

- iOS: a versioned UserDefaults draft holds the editable server HTTPS origin, optional private IP and username, including a failed first attempt. It never stores a password or token. Native Keychain v2 remains the independent Owner-bound rotating session. Failed attempts keep the password only in the live form; verified successful login and explicit sign-out clear it. Restoration preserves a configured domain/IP pair only when the Keychain endpoint is that exact domain or that domain's derived LAN endpoint.
- Android: existing Preferences store the independent login draft before calling the remote login API. Existing encrypted sessions from older builds migrate their non-secret username/server/IP hint before refresh can return 401 and clear the token; a newer draft for another Owner/Server is never overwritten. Only the currently valid HTTPS address, LAN IP and username are saved; password and access tokens stay out of Preferences. Keystore still owns the rotating refresh session. On logout or 401, the editable username remains (except explicit server switch); revocation still clears the Keystore token.
- In both platforms login identity and certificate validation still happen before sending credentials, and any saved draft is **never** proof of an authenticated Owner.

Tests: `node --test desktop/tests/native-login-draft-resilience.cjs`; iOS build and Android compile/test workflows are required for the exact PR head. Physical iOS/Android behavior remains unverified until device testing.
