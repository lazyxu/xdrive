# xDrive Clipboard — cross-device design and Web MVP

Status: Web MVP merged in #3950 with hardening through #4046; six-platform native/Host/E2EE and Owner-scoped SSE source merged in #4068 (master commit `c83bcf3bd00dc817c9214386efe0743093ad0fc8`, complete CI and Final Gate passed). Follow-up #4079 merged to master as commit `4b59ca80e52ebeb8998199f09d2900e62fa240ae` after its independent exact-head CI, iOS IPA, Android Gradle and Final Gate passed; it adds Native Lock/Owner lifecycle fences and real SSE revocation tests. A source merge does not prove production deployment or physical-device verification.

## 1. Product boundary

Clipboard is **not** FileExplorer's existing Copy/Cut/Paste state. The latter uses Node/Revision and durable Copy/Move operations and must retain its generation/Owner fencing. Clipboard is an Owner-private, short-lived encrypted text mailbox shared by explicitly opened xDrive clients. It does not create any Node, CAS blob, UploadSession, Push/Pull Source or task.

**Web MVP (this work):** same-Owner Web/PWA and mobile browser manual text/URL send, optional user-gesture read of the local clipboard, encrypted recent history, decrypt/copy back to the OS clipboard, delete one, clear all, bounded paging, and foreground refresh. No automatic system clipboard monitoring, device pairing, per-device delivery, background execution, image/file payloads, universal copy/paste or native Agent/DSM claims.

**Later:** registered-device-enrolled per-device authorization and E2EE group-key wrapping, targeted fan-out, optional native SSE consumers, Desktop Windows/macOS/Linux OS listener, an iOS Clipboard Share Extension, image/object TTL store and verified Owner Node references. Mobile background clipboard monitoring is **not a promised capability**. Use WebClipboard only with user gestures, including HTTP-LAN/browser clipboard API failures.

## 2. Ownership and security

- Only the existing **revocable Owner bearer session** accesses `/api/v1/clipboard/*`; never a SourceRun bearer, Photo background grant or public-share token. The Server uses authenticated `userID(c)` for all predicates and does not accept OwnerID from JSON.
- E2EE Web MVP: Browser explicitly unlocks a clipboard vault with a distinct user-chosen passphrase, length >= 12. Server supplies/stores one random 16-byte **per-Owner salt** and a one-time encrypted, immutable canary (`check_nonce/check_ciphertext`) to reject wrong passphrases before new messages are sent; never the passphrase, raw key or plaintext. Browser derives a non-exportable AES-256-GCM key via PBKDF2-HMAC-SHA256 (310,000 iterations); every message has a fresh 96-bit nonce, a UUID `client_event_id`, and authenticated AAD binding the Owner scope, media kind and event ID. Server stores only base64 ciphertext, nonce and limited routing metadata.
- The same account on another Web browser must enter the **same clipboard vault passphrase** to decrypt history; a wrong passphrase produces a visible decrypt failure, never silent key rotation or plaintext fallback. The Web MVP does **not** support lost-passphrase recovery or trusted-device key exchange. Deleting the history does not change the vault salt or recover forgotten passphrases.
- Cryptographic material lives in the mounted Owner-scoped React page **memory only**, not localStorage, IndexedDB, URL/hash, Service Worker cache, logs or telemetry. Logout, Server change or Owner switch disposes the page and key; no old response may paint another Owner's history.
- WebCrypto requires a secure context (HTTPS or browser-approved localhost). On arbitrary HTTP LAN hosts, refuse E2EE send/read rather than silently uploading plaintext; users can still manually copy text in existing supported browser situations.
- No Server logs of ciphertext/nonce or plaintext; API responses use `Cache-Control: no-store`. Revocation blocks later reads, but cannot erase content already copied to a device's OS clipboard. Browser UI must warn about sensitive material; **automatic** clipboard interception stays off.
- Public share credentials, Agent device tokens, Root fingerprints, backup grants and FileExplorer clipboard cannot be reused as Clipboard authorization.

## 3. Persistence and transport

- `xd_clipboard_vaults`: unique OwnerID, random Salt, immutable encrypted verifier and original `AADScope` (first browser HTTPS/localhost origin + Server-verified Owner ID). Concurrent initialization uses PostgreSQL ON CONFLICT DO NOTHING. The scope is authenticated encryption metadata, never a token or a permission; each later authenticated browser retrieves and uses the first pinned scope, even when accessing the same Server by another hostname.
- `xd_clipboard_items`: monotonically allocated row ID (stable cursor), OwnerID, ClientEventID (unique for Owner), Kind, Nonce, Ciphertext, ExpiresAt, CreatedAt. No plaintext preview/index.
- Up to 64 KiB of *plaintext* is allowed by the Web UI; Server imposes a conservative bound on encrypted wire bytes and validates base64/96-bit nonce/UUID/kind. A PostgreSQL row lock on the authenticated Owner's vault serializes insertion plus cap pruning, retaining at most 50 newest nonexpired rows even when several browsers send concurrently; the encrypted verifier must already be initialized. Expiry is 24 hours server-side, with opportunistic pruning and no claims of exact real-time global GC.
- `GET /api/v1/clipboard/vault`: Owner-scoped salt, initialized idempotently. `POST /api/v1/clipboard/items`: write one encrypted item; `GET /api/v1/clipboard/items?before=ID`: 50-row descending keyset page; `DELETE /api/v1/clipboard/items/:id`: remove one; `DELETE /api/v1/clipboard/items`: clear current Owner's history.
- Idempotency: `(OwnerID, ClientEventID)` uniqueness **while the item is retained and unexpired**; a retry of a retained identical *live* event returns the original receipt. A retained but expired matching ID yields HTTP 409, never a false successful delivery receipt. The Browser keeps the same encrypted bytes/ID after an unknown ACK only within a five-minute local retry window. Editing or pasting a different draft must not silently replace a pending receipt; the user must inspect history and explicitly abandon that receipt before sending a new EventID. After the retry window, or after a local clock rollback, it refuses replay and likewise requires explicit abandon before a new send. Cap eviction may erase the original idempotency record sooner; the MVP therefore does **not** claim indefinite exactly-once delivery. **No cross-device target ID in MVP**; all authenticated sessions of the same Owner use the same mailbox.
- Browser reads while the Clipboard page is visible (foreground refresh), and manually on demand; **the originally merged Web MVP had no SSE, background clipboard API or invisible global polling**. The merged six-platform implementation adds Owner-scoped SSE as an optional invalidation signal, retains the 15-second foreground GET fallback, and never reads the OS clipboard without a user gesture. Backend pagination is bounded, cancellation through AbortSignal, stale response fencing on Owner changes.

## 4. Native client growth (historical Web MVP boundary)

Windows Agent: interactive user-session clipboard event listening; suppress local injected events, hash/ID replay, merge by authoritative server sequence and never overwrite newer local clipboard input. Linux: X11/XFixes where available; Wayland compositor-dependent manual fallback. iOS: native Share Extension and UIPasteControl under user gesture. Android: ACTION_SEND and Compose clipboard interaction with OS background restrictions. DSM: authenticated Browser/Host page only; NAS agent cannot read the visiting person's local OS clipboard. Registered devices require a distinct Clipboard capability and approved key-wrapping handshake, not generic Device token rights.

## 5. UI and integration

One `clipboard` workspace route and `XDriveClipboardPage` shared React/MUI presentation. Web supplies an authenticated narrow `XDriveClipboardDataPort` through `browserWorkspaceHost`; Desktop/DSM lacking this port show a truthful unavailable state, never fake support. Keep both Desktop and DSM on their canonical `XDriveApp`, and native iOS/Android on their respective native UI frameworks. Web hash `#/app/clipboard` must round-trip and remain navigable from Web sidebar/mobile tool launcher.

## 6. Acceptance and tests

- Authenticated same Owner Browser A send -> Browser B after unlock/foreground refresh -> decrypt/copy; Unicode, links, multiline and empty/oversize rejection.
- Wrong passphrase, tampered AEAD ciphertext/AAD/nonce, malformed base64, missing WebCrypto, HTTP non-secure context: fail closed; never claim successful copy after a browser denial.
- Owner A/B isolation for vault, lists, deletes and clear; forbidden SourceRun bearer, disabled/revoked session, unauthenticated access, UUID and payload validation, idempotency, 50-row bounded paging and TTL.
- React Owner A→B→A and route teardown abort stale requests and discard crypto keys/visible data; no unbounded history, private storage or console logs; preserve existing FileExplorer clipboard.
- Required Go/PostgreSQL integration and Web build/lint/router tests must run on the **exact PR HEAD**, including Final Gate. Physical browser/device/production acceptance: **跳过（未验收）** unless actually exercised. Never report queued or skipped CI as successful.

## 7. Source wiring and release gate

The Web MVP files deliberately share the canonical Host/UI boundary:

| Contract | Code |
| --- | --- |
| Authenticated API routes and Server metadata | `internal/api/router.go`, `internal/api/clipboard.go`, `internal/meta/clipboard.go` |
| Startup schema | `cmd/server/main.go` |
| Browser-only WebCrypto and passphrase verifier | `ui/shared/src/clipboard-crypto.ts` |
| One shared React presentation and typed data port | `ui/shared/src/mui/ClipboardPage.tsx`, `ui/shared/src/mui/WorkspaceHostAdapter.ts` |
| Web/PWA adapters and user-gesture copy/read | `web/src/api.ts`, `web/src/clipboardDataPort.ts`, `web/src/browserClipboard.ts` |
| Web navigation and mobile tool entry | `ui/shared/src/web-app.ts`, `web/src/webApps.ts`, `web/src/App.tsx` |
| Server/route regression coverage | `internal/api/clipboard_api_test.go`, `internal/api/router_contract_test.go`, `web/scripts/test-web-clipboard-mvp.mjs`, shared Desktop route parity tests |

This change is **Web-only** even though its page is registered in the canonical Desktop/DSM route registry; those Hosts receive a truthful unavailable state unless an authenticated Clipboard port is separately provided. Registration does not grant local OS clipboard privileges.

The clipboard password is intentionally distinct from the xDrive login password, is not recoverable from the Server and is not written to Browser persistent storage. Multiple browsers of the same Owner must use an identical password to unlock the immutable encrypted verifier; no implicit reset is allowed. This protects confidentiality but does not protect already-decrypted content from the local Browser or OS.

PR acceptance is source-SHA-specific: successful Web TypeScript/build and crypto regression, genuine PostgreSQL Owner-isolation tests, `gofmt`/Go race and shared Desktop/DSM navigation parity, plus all required Final Gate checks. A Draft PR, successful isolated check, queued job or a merge commit on a development branch is not proof of publication or deployment.

## 8. Public/LAN origin AAD compatibility and concurrent sends

The original Web MVP used `window.location.origin + ':' + verifiedOwnerID` in AES-GCM authenticated associated data. Different HTTP(S) aliases of one Server therefore derived **the same key from salt/passphrase** but produced different AAD, so a second URL could not unlock the original canary.

The patched contract persists `AADScope` with the immutable encrypted verifier on initial `PUT /api/v1/clipboard/vault/check`; subsequent `GET /vault` responses expose the unchanged scope to the same authenticated Owner. Browsers still keep their **local** `ownerScopeKey` (actual origin and verified Owner) for React session separation, but use **only the Server-pinned `aad_scope`** for the encryption canary, sending and history decryption. Server validates that a proposed scope is a canonical HTTP(S) origin plus **its own authenticated OwnerID**; a conflicting or second-origin claim never rewrites an existing nonempty scope or canary.

**Pre-existing vaults:** #3950 persisted a canary but had no `AADScope` column. After a successful client-side AES-GCM verification on the original browser origin, that existing ciphertext/nonce pair may claim the missing AAD scope once using the same authenticated endpoint. No passphrase, key or historical message is rotated; a second browser alias can then decrypt the existing history. Before the first legacy origin pins its scope, another alias still cannot infer the original origin or decrypt the old canary. Do not auto-reset or bypass that verification.

The `POST /clipboard/items` transaction acquires `SELECT ... FOR UPDATE` on the authenticated Owner vault **before** inserting and pruning. This serializes parallel submissions for the same Owner across Go Server instances and rejects uninitialized vault writes; independently authenticated Owners do not serialize each other. Tests must cover legacy pinning, incorrect scope/Owner, two different browser-origin strings and a real PostgreSQL concurrent write burst ending with exactly 50 rows. Any production or real-device behavior not exercised must be reported as **跳过（未验收）**.

## 9. Six-platform integration and native lifecycle follow-up

**Merge-status checkpoint (2026-11-07):** #4068 merged to master with exact tested head `6efdcb48c399763fc3955c1ec3a755b275987ac9` and squash commit `c83bcf3bd00dc817c9214386efe0743093ad0fc8`. The six-platform code listed below is in master source, not a claim of production release or physical-device acceptance. Its predecessor source PRs #4055 / #4065 are closed; #4067 was only staging. #4079's seven-file incremental lifecycle/SSE test follow-up also merged to master, without rewriting the accepted #4068 history.

| Client or capability | Candidate implementation | Boundary |
| --- | --- | --- |
| Web/PWA | `web/src/clipboardDataPort.ts` + shared `XDriveClipboardPage` | Browser user gesture for OS clipboard; authenticated owner AES-GCM vault |
| Desktop | `cmd/xdrive-agent/desktop_ipc_clipboard.go`, `desktop/src/renderer/desktopClipboardDataPort.ts` | Explicit local OS clipboard operations, narrow six-operation Owner IPC; no generic proxy or Device-credential privilege |
| DSM | `internal/synologyui/owner_clipboard.go`, `web/src/synologyClipboardPort.ts` | Canonical shared React UI, authenticated CGI and Owner scope; **browser** OS clipboard, never NAS OS clipboard |
| iOS Native | `ios/XDriveIOS/NativeClipboardClient.swift`, `ios/XDriveIOS/NativeClipboardScreen.swift` | SwiftUI user-triggered paste/copy/send, verified HTTPS Owner and Web v1 crypto; no separate Clipboard Share Extension target in #4068 |
| Android Native | `NativeClipboardScreens.kt`, `XDriveClipboardCrypto.kt` | Compose manual paste/copy/send plus `ACTION_SEND` text draft; no background observer |
| SSE | `internal/api/clipboard.go`, `web/src/api.ts::clipboardWatchChanges` | Server returns only Owner-scoped `sync/change` cursors; stream expires after 20 seconds with renewed authentication; Browser GET is authoritative and 15s foreground polling remains. Native clients poll every 15 seconds only while their scene/activity is foreground-visible (with an immediate GET on resume), not native SSE subscriptions |
| Interoperability | `tests/fixtures/clipboard-v1-interoperability.json` and Web/Android crypto tests | PBKDF2-SHA256, AES-256-GCM, pinned AAD, Unicode/URI, EventID and tamper rejection; passwords and keys never persist as plaintext |

**Merged #4079 lifecycle protection:** a same-Owner manual Lock, Owner change, or page disposal must invalidate asynchronous unlock/read/send/delete/clear completions even if the network delivers a valid late ACK. The iOS generation and Android `XDriveClipboardSessionFence` are reviewed in source and Android has executable JVM test cases. Its own iOS IPA, Android Gradle, full CI and Final Gate passed on the final HEAD; source-level contracts alone would not have been sufficient. An already-committed message may remain on the Server even when its reply is ignored after Lock; do not misreport such a send as undone.

**Still not implemented in this integration:** optional Desktop background OS-clipboard watching with feedback suppression, explicit device-targeted key wrapping and delivery, image/file Clipboard TTL objects and node references, iOS Clipboard Share Extension, and optional Native SSE readers. Android `ACTION_SEND` must not be mislabeled as an iOS Share Extension. All such work needs separate Owner-scope and failure-mode tests; it must not compromise the successful manual text mailbox or create an alternative CAS writer.
