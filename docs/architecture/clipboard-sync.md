# xDrive Clipboard — cross-device design and Web MVP

Status: Web MVP implementation in progress (2026-11-06). **This document describes a target contract; it does not prove that a browser, device, CI run, or deployed server has passed acceptance.**

## 1. Product boundary

Clipboard is **not** FileExplorer's existing Copy/Cut/Paste state. The latter uses Node/Revision and durable Copy/Move operations and must retain its generation/Owner fencing. Clipboard is an Owner-private, short-lived encrypted text mailbox shared by explicitly opened xDrive clients. It does not create any Node, CAS blob, UploadSession, Push/Pull Source or task.

**Web MVP (this work):** same-Owner Web/PWA and mobile browser manual text/URL send, optional user-gesture read of the local clipboard, encrypted recent history, decrypt/copy back to the OS clipboard, delete one, clear all, bounded paging, and foreground refresh. No automatic system clipboard monitoring, device pairing, per-device delivery, background execution, image/file payloads, universal copy/paste or native Agent/DSM claims.

**Later:** registered-device-enrolled per-device authorization and E2EE group-key wrapping, targeted fan-out, SSE notification with durable cursor, Desktop Windows/macOS/Linux OS listener, native iOS/Android Share Extension/intent, image/object TTL store and verified Owner Node references. Mobile background clipboard monitoring is **not a promised capability**. Use WebClipboard only with user gestures, including HTTP-LAN/browser clipboard API failures.

## 2. Ownership and security

- Only the existing **revocable Owner bearer session** accesses `/api/v1/clipboard/*`; never a SourceRun bearer, Photo background grant or public-share token. The Server uses authenticated `userID(c)` for all predicates and does not accept OwnerID from JSON.
- E2EE Web MVP: Browser explicitly unlocks a clipboard vault with a distinct user-chosen passphrase, length >= 12. Server supplies/stores one random 16-byte **per-Owner salt** and a one-time encrypted, immutable canary (`check_nonce/check_ciphertext`) to reject wrong passphrases before new messages are sent; never the passphrase, raw key or plaintext. Browser derives a non-exportable AES-256-GCM key via PBKDF2-HMAC-SHA256 (310,000 iterations); every message has a fresh 96-bit nonce, a UUID `client_event_id`, and authenticated AAD binding the Owner scope, media kind and event ID. Server stores only base64 ciphertext, nonce and limited routing metadata.
- The same account on another Web browser must enter the **same clipboard vault passphrase** to decrypt history; a wrong passphrase produces a visible decrypt failure, never silent key rotation or plaintext fallback. The Web MVP does **not** support lost-passphrase recovery or trusted-device key exchange. Deleting the history does not change the vault salt or recover forgotten passphrases.
- Cryptographic material lives in the mounted Owner-scoped React page **memory only**, not localStorage, IndexedDB, URL/hash, Service Worker cache, logs or telemetry. Logout, Server change or Owner switch disposes the page and key; no old response may paint another Owner's history.
- WebCrypto requires a secure context (HTTPS or browser-approved localhost). On arbitrary HTTP LAN hosts, refuse E2EE send/read rather than silently uploading plaintext; users can still manually copy text in existing supported browser situations.
- No Server logs of ciphertext/nonce or plaintext; API responses use `Cache-Control: no-store`. Revocation blocks later reads, but cannot erase content already copied to a device's OS clipboard. Browser UI must warn about sensitive material; **automatic** clipboard interception stays off.
- Public share credentials, Agent device tokens, Root fingerprints, backup grants and FileExplorer clipboard cannot be reused as Clipboard authorization.

## 3. Persistence and transport

- `xd_clipboard_vaults`: unique OwnerID and random Salt. Concurrent initialization uses PostgreSQL ON CONFLICT DO NOTHING then reads the accepted value.
- `xd_clipboard_items`: monotonically allocated row ID (stable cursor), OwnerID, ClientEventID (unique for Owner), Kind, Nonce, Ciphertext, ExpiresAt, CreatedAt. No plaintext preview/index.
- Up to 64 KiB of *plaintext* is allowed by the Web UI; Server also imposes a conservative bound on encrypted wire bytes and validates base64/96-bit nonce/UUID/kind. 50 latest nonexpired rows per Owner retained; expiry is 24 hours server-side, with opportunistic pruning and no claims of exact real-time global GC.
- `GET /api/v1/clipboard/vault`: Owner-scoped salt, initialized idempotently. `POST /api/v1/clipboard/items`: write one encrypted item; `GET /api/v1/clipboard/items?before=ID`: 50-row descending keyset page; `DELETE /api/v1/clipboard/items/:id`: remove one; `DELETE /api/v1/clipboard/items`: clear current Owner's history.
- Idempotency: `(OwnerID, ClientEventID)` uniqueness; repeated identical POST returns the existing receipt, not a second item. **No cross-device target ID in MVP**; all authenticated sessions of the same Owner use the same mailbox.
- Browser reads while the Clipboard page is visible (foreground refresh), and manually on demand; **no SSE, background clipboard API, notification subscription, or invisible global polling in this MVP**. Backend pagination is bounded, cancellation through AbortSignal, stale response fencing on Owner changes.

## 4. Native client growth (not implemented here)

Windows Agent: interactive user-session clipboard event listening; suppress local injected events, hash/ID replay, merge by authoritative server sequence and never overwrite newer local clipboard input. Linux: X11/XFixes where available; Wayland compositor-dependent manual fallback. iOS: native Share Extension and UIPasteControl under user gesture. Android: ACTION_SEND and Compose clipboard interaction with OS background restrictions. DSM: authenticated Browser/Host page only; NAS agent cannot read the visiting person's local OS clipboard. Registered devices require a distinct Clipboard capability and approved key-wrapping handshake, not generic Device token rights.

## 5. UI and integration

One `clipboard` workspace route and `XDriveClipboardPage` shared React/MUI presentation. Web supplies an authenticated narrow `XDriveClipboardDataPort` through `browserWorkspaceHost`; Desktop/DSM lacking this port show a truthful unavailable state, never fake support. Keep both Desktop and DSM on their canonical `XDriveApp`, and native iOS/Android on their respective native UI frameworks. Web hash `#/app/clipboard` must round-trip and remain navigable from Web sidebar/mobile tool launcher.

## 6. Acceptance and tests

- Authenticated same Owner Browser A send -> Browser B after unlock/foreground refresh -> decrypt/copy; Unicode, links, multiline and empty/oversize rejection.
- Wrong passphrase, tampered AEAD ciphertext/AAD/nonce, malformed base64, missing WebCrypto, HTTP non-secure context: fail closed; never claim successful copy after a browser denial.
- Owner A/B isolation for vault, lists, deletes and clear; forbidden SourceRun bearer, disabled/revoked session, unauthenticated access, UUID and payload validation, idempotency, 50-row bounded paging and TTL.
- React Owner A→B→A and route teardown abort stale requests and discard crypto keys/visible data; no unbounded history, private storage or console logs; preserve existing FileExplorer clipboard.
- Required Go/PostgreSQL integration and Web build/lint/router tests must run on the **exact PR HEAD**, including Final Gate. Physical browser/device/production acceptance: **跳过（未验收）** unless actually exercised. Never report queued or skipped CI as successful.
