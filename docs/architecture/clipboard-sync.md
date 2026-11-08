# xDrive Clipboard — current architecture and original Web MVP history

**Current source status (2026-11-08):** The six-platform Owner-bound v1 baseline (#4068), Native lifecycle hardening (#4079/#4081), Native foreground SSE and v2 device-targeting integration (#4106, merged as `de24724740af604fb147fd17ab84bbf9b685d5b3`), and iOS/Android existing Files Viewer support for encrypted CAS Node references (#4110, merged as `e69537a8cfca3604a3e6075a0244a81a70e96425`) are all in `master`. #4106 passed **38 applicable checks** and Final Gate; #4110 passed **37 applicable checks** and Final Gate; their other checks were explicitly skipped, not failures. The original #4086 was closed without a duplicate merge. These facts establish merged tested source, **not** installed production or real-device acceptance.

**Present capabilities and limits:** Web/PWA can explicitly send v1 Owner broadcast text and encrypted v2 directed text/links/existing CAS Node references to enrolled devices; iOS/Android can enroll independently and decrypt directed receipts, including opening a verified existing file via their native Files Viewer. Desktop's opt-in local text watcher is **off by default** and active only in the unlocked visible page; Desktop and DSM outbound Agent/CGI transports remain **v1 text-only and explicitly reject** unsupported directed/media messages rather than downgrading to broadcast. iOS Share Extension is a user-triggered, local-only, 120-second paste handoff, not automatic encrypted sending. **Direct local image/file Clipboard ingestion through the existing UploadSession/CAS writer remains incomplete**; only previously uploaded Owner file Nodes can be referenced. There is no mobile background OS clipboard monitoring.

Sections explicitly labelled **original Web MVP**, **historical baseline** or **historical roadmap** describe earlier accepted scopes, not current missing features. Unaccepted follow-up work belongs in Issue #4047.

## 1. Product boundary

Clipboard is **not** FileExplorer's existing Copy/Cut/Paste state. The latter uses Node/Revision and durable Copy/Move operations and must retain its generation/Owner fencing. Clipboard is an Owner-private, short-lived encrypted mailbox for text and authenticated references to existing file Nodes, shared by explicitly opened xDrive clients. It does not create any Node, CAS blob, UploadSession, Push/Pull Source or task.

**Original Web MVP (historical scope):** same-Owner Web/PWA and mobile browser manual text/URL send, optional user-gesture read of the local clipboard, encrypted recent history, decrypt/copy back to the OS clipboard, delete one, clear all, bounded paging, and foreground refresh. No automatic system clipboard monitoring, device pairing, per-device delivery, background execution, image/file payloads, universal copy/paste or native Agent/DSM claims.

**Original roadmap, partially delivered since #4106/#4110 (historical):** registered-device-enrolled per-device authorization and E2EE key wrapping, targeted fan-out, optional Desktop Windows/macOS/Linux OS listener, native iOS Share Extension, image/object TTL store and verified Owner Node references. Server/Web SSE and Android ACTION_SEND are already implemented; native SSE subscribers are in a separate foreground-only implementation. Mobile background clipboard monitoring is **not a promised capability**. Use WebClipboard only with user gestures, including HTTP-LAN/browser clipboard API failures.

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

One `clipboard` workspace route and `XDriveClipboardPage` shared React/MUI presentation. Web supplies authenticated `XDriveClipboardDataPort`; Desktop and DSM now provide their own Owner-bound narrow ports via the canonical shared UI, never an unauthenticated proxy. Hosts without the verified port still show a truthful unavailable state. Native iOS/Android use their respective native UI frameworks. Web hash `#/app/clipboard` remains navigable from the sidebar/mobile tool launcher.

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

The **original #3950 Web MVP** was Web-only; subsequent #4068 added genuine Desktop/DSM Owner-bound ports and native clients. Route registration alone never grants local OS clipboard or authentication privileges.

The clipboard password is intentionally distinct from the xDrive login password, is not recoverable from the Server and is not written to Browser persistent storage. Multiple browsers of the same Owner must use an identical password to unlock the immutable encrypted verifier; no implicit reset is allowed. This protects confidentiality but does not protect already-decrypted content from the local Browser or OS.

PR acceptance is source-SHA-specific: successful Web TypeScript/build and crypto regression, genuine PostgreSQL Owner-isolation tests, `gofmt`/Go race and shared Desktop/DSM navigation parity, plus all required Final Gate checks. A Draft PR, successful isolated check, queued job or a merge commit on a development branch is not proof of publication or deployment.

## 8. Public/LAN origin AAD compatibility and concurrent sends

The original Web MVP used `window.location.origin + ':' + verifiedOwnerID` in AES-GCM authenticated associated data. Different HTTP(S) aliases of one Server therefore derived **the same key from salt/passphrase** but produced different AAD, so a second URL could not unlock the original canary.

The patched contract persists `AADScope` with the immutable encrypted verifier on initial `PUT /api/v1/clipboard/vault/check`; subsequent `GET /vault` responses expose the unchanged scope to the same authenticated Owner. Browsers still keep their **local** `ownerScopeKey` (actual origin and verified Owner) for React session separation, but use **only the Server-pinned `aad_scope`** for the encryption canary, sending and history decryption. Server validates that a proposed scope is a canonical HTTP(S) origin plus **its own authenticated OwnerID**; a conflicting or second-origin claim never rewrites an existing nonempty scope or canary.

**Pre-existing vaults:** #3950 persisted a canary but had no `AADScope` column. After a successful client-side AES-GCM verification on the original browser origin, that existing ciphertext/nonce pair may claim the missing AAD scope once using the same authenticated endpoint. No passphrase, key or historical message is rotated; a second browser alias can then decrypt the existing history. Before the first legacy origin pins its scope, another alias still cannot infer the original origin or decrypt the old canary. Do not auto-reset or bypass that verification.

The `POST /clipboard/items` transaction acquires `SELECT ... FOR UPDATE` on the authenticated Owner vault **before** inserting and pruning. This serializes parallel submissions for the same Owner across Go Server instances and rejects uninitialized vault writes; independently authenticated Owners do not serialize each other. Tests must cover legacy pinning, incorrect scope/Owner, two different browser-origin strings and a real PostgreSQL concurrent write burst ending with exactly 50 rows. Any production or real-device behavior not exercised must be reported as **跳过（未验收）**.

## 9. Six-platform integration and native lifecycle follow-up

**Merge-status checkpoint (2026-11-07):** #4068 and #4079 both merged to master after exact-head full CI/Final Gate. Source is not proof of physical-device or production acceptance. #4055/#4065 were closed and #4067 was staging only; no earlier tested PR history is rewritten.

| Client or capability | Implemented source | Boundary |
| --- | --- | --- |
| Web/PWA | `web/src/clipboardDataPort.ts` + shared `XDriveClipboardPage` | Browser user gesture for OS clipboard; authenticated owner AES-GCM vault |
| Desktop | `cmd/xdrive-agent/desktop_ipc_clipboard.go`, `desktop/src/renderer/desktopClipboardDataPort.ts` | Explicit local OS clipboard operations, narrow six-operation Owner IPC; no generic proxy or Device-credential privilege |
| DSM | `internal/synologyui/owner_clipboard.go`, `web/src/synologyClipboardPort.ts` | Canonical shared React UI, authenticated CGI and Owner scope; **browser** OS clipboard, never NAS OS clipboard |
| iOS Native | `ios/XDriveIOS/NativeClipboardClient.swift`, `ios/XDriveIOS/NativeClipboardScreen.swift` | SwiftUI user-triggered paste/copy/send, verified HTTPS Owner and Web v1 crypto; no separate Clipboard Share Extension target in #4068 |
| Android Native | `NativeClipboardScreens.kt`, `XDriveClipboardCrypto.kt` | Compose manual paste/copy/send plus `ACTION_SEND` text draft; no background observer |
| SSE | `internal/api/clipboard.go`, `web/src/api.ts::clipboardWatchChanges` | Server returns only Owner-scoped `sync/change` cursors, 20s max streams with renewed authentication; Web GET is authoritative, with 15s visible polling fallback. Native foreground SSE client source is separately defined below |
| Interoperability | `tests/fixtures/clipboard-v1-interoperability.json` and Web/Android crypto tests | PBKDF2-SHA256, AES-256-GCM, pinned AAD, Unicode/URI, EventID and tamper rejection; passwords and keys never persist as plaintext |

**#4079 merged lifecycle protection:** same-Owner manual Lock, Owner change or page disposal invalidates asynchronous unlock/read/send/delete/clear callbacks; iOS generation and Android `XDriveClipboardSessionFence` have executable regression tests. Exact-head CI and Final Gate passed. Already-committed Server writes cannot be undone merely by discarding a late ACK.

**Post-baseline integration (merged):** #4106 includes Desktop visible/unlocked opt-in text monitoring, Web sender → native-device v2 X25519/AES-GCM targeting, authenticated existing CAS Node references, native SSE and a real iOS Share Extension target. #4110 adds current-Owner-verified native file/image Viewer entry. The iOS extension uses explicit local paste, unlike Android `ACTION_SEND`; neither grants a background Clipboard or File permission. Desktop/DSM directed v2 and local binary Clipboard upload remain separate backlog items (#4047).

## 10. Native foreground SSE contract (merged #4106)

The Native iOS/Android foreground Clipboard pages use an **optional** short-lived Owner bearer GET `/api/v1/clipboard/events?after=CURSOR`. They do not listen to the OS clipboard automatically; no key, passphrase, payload, ciphertext, token or Owner ID is carried in SSE frames. An in-memory, monotonic event cursor accepts only complete `sync` or `change` events with `data: {}`, a positive decimal change ID, and bounded 4096-byte text lines. Invalid/malicious content fails closed. Server pings are ignored.

**On a valid change**, the native UI runs an authenticated full `GET /clipboard/items` and decrypts using the current unlocked Owner key; the stream never substitutes for that GET. **On disconnect or lost events**, reconnect after a bounded delay with the current cursor and perform a full Owner GET; retain the independent 15-second foreground polling fallback. Every reconnect revalidates the current Owner/bearer; Lock, Owner change, page dismissal and cancellation stop the subscription and clear in-memory secrets. Android uses the existing pinned-OkHttp Owner transport and Compose Main-thread update; iOS uses an ephemeral HTTPS URLSession with no redirects/cookies and bounded UTF-8 byte framing. Both the 15-second GET and SSE socket are bound to SwiftUI `scenePhase == .active` or Android `Lifecycle.State.STARTED`; an immediate full GET reconciles the current Owner after returning from background. No background SSE job is registered.

Native SSE code and protocol tests: `android/core/.../XDriveClipboardSSECursor.kt`, `ios/XDriveIOS/NativeClipboardSSECursor.swift`, Android JUnit parser tests and executable `ios/tests/ClipboardSSECursorChecks.swift`. The native SSE implementation passed the exact #4106 HEAD's applicable complete CI, Final Gate and iOS Unsigned IPA, and is merged into `master`. Legacy/unsupported Server behaviour must remain functional via foreground polling.


## 11. Clipboard v2 multi-platform integration (merged #4106; native Viewer #4110)

**Delivery status:** The original #4086 was superseded and closed without merging. The integrated implementation was reviewed and merged in #4106 at exact HEAD `fd0231bf2e1f5b9931c8f1d187ea5da23c313139` (38 successful checks, 5 explicit skips, Final Gate success). The native file Viewer completion was merged in #4110 at exact HEAD `21a19ef7a479734d64f1d66bd3db474ad7ce184d` (37 successful checks, 6 explicit skips, Final Gate success). Those results validate the respective tested source, not manual production or physical-device behaviour.

### Desktop opt-in local monitoring

The shared UI offers a Desktop-only opt-in switch (off by default). The Electron preload remains the same explicit local OS `readClipboardText` capability; it is polled only while the Clipboard screen is mounted, unlocked and visible. The first sampled value is discarded; repeats, blank/over-limit messages, locally copied remote content, and uncertain-send ACKs are not automatically re-sent. Lock, Owner change, hiding/disposal or unsubscribe cancels observation. Sensitive passwords and one-time codes may still appear in an OS clipboard: enable only with user consent, show a clear warning, never silently turn it on, and do not promise content classification.

### iOS user-triggered Share Extension

The embedded `xDriveClipboardShare` target accepts selected plain text/URL under the iOS share sheet with 64 KiB bounds. Its **only** cross-process handoff is a user-tapped, local-only system paste with a 120-second expiry; it never receives xDrive Owner bearer, vault passphrase, derived key or encrypted history. The user must explicitly return to the Native Clipboard page, unlock, paste and send. Do **not** misrepresent this as automatic direct encrypted delivery from an Extension; that remains a separate integration step.

### Device-targeted end-to-end encryption (v2 merged #4106)

- A registered ClientDevice ID alone does **not** authorize Clipboard receipt. The user explicitly enrolls a separate `xd_clipboard_device_keys` record, requiring a live Owner session plus the current device installation credential. Enrollment pins an immutable 32-byte X25519 public key; revocation cannot be undone by supplying a different key. The device private key stays in native secure storage (iOS ThisDeviceOnly Keychain; Android independently enrolled recipient key sealed under Android Keystore).
- The sender obtains the selected Owner's active public key from `GET /clipboard/devices`; no private key is sent to the Server. For each message it generates a random 256-bit AES-GCM content key and ephemeral X25519 key pair. The ephemeral shared secret is fed to HKDF-SHA256: salt = SHA256(`base + "|salt"`), info = `base + "|wrap"`, with `base = "xdrive-clipboard-target-v1|" + pinnedOwnerAAD + "|" + eventUUID + "|" + recipientUUID`.
- `wrapped_key` is 12-byte AES-GCM wrapping nonce + 48-byte encrypted content key/tag; `ephemeral_key` is the 32-byte ephemeral public key. AEAD additional data includes `base`, media kind and NodeID separately for wrapping (`"|key|"`) and content (`"|content|"`), guarding re-targeting, type substitution and Node swapping. The Server never derives or returns the content key.
- Ordinary v1 broadcast text remains unchanged. Directed rows are filtered from unauthenticated/unregistered other device views and SSE invalidations; an Owner interactive session and the exact authorized device credentials are both required to read directed rows. Revocation stops future retrieval but cannot remove decrypted plaintext already copied locally.
- File/image kinds are **references** to existing live Owner file Nodes created by the normal UploadSession/CAS writer. The Server rejects foreign, deleted, non-file or missing-CAS-original Nodes; Web offers an Owner-only bounded file picker, and iOS/Android receivers reverify the current Owner and exact file before opening their existing Files Viewer (#4110). This does **not** upload binary clipboard content: local OS image/file import, user-triggered UploadSession/CAS creation and directed delivery of newly uploaded objects remain P2. Neither the node ID nor an encrypted Clipboard receipt is a standalone File read grant.

### Verified merge gates and requirements for future changes

Both #4106 and #4110 satisfied their own exact-HEAD applicable CI and Final Gate before merge. For every **future** change touching the following security and protocol boundaries, these gates must be checked again on its actual HEAD:

1. `gofmt`, Go build/race, real PostgreSQL Owner A/B + per-device authorization/revoke, SSE late-cursor and unknown-ACK regressions, plus immutable key-enrollment and Node ownership tests.
2. Web TypeScript/build and executable X25519/HKDF/AES-GCM cross-platform interoperability and tampered target/nonce/kind/Node rejection.
3. Desktop opt-in lifecycle, no-first-snapshot, echo suppression, lock/Owner switch and failure/reconnect tests; retain existing manual send semantics.
4. iOS unsigned IPA with an actually embedded Share Extension plus native device public-key registration/Keychain decryption; Android Gradle/JVM/MockWebServer and native lifecycle coverage.
5. Applicable full CI, Final Gate and protected master merge through PR only.

**Future unverified or incomplete candidates must remain Draft and unmerged.** Production/manual physical-device acceptance for the merged implementation: 跳过（未验收）.

**Android API29–32 compatibility (merged #4106):** The Android minSdk is 29, before system JCA XDH support at API33. Its receiver uses pinned Bouncy Castle 1.86 low-level X25519 with a validated 48-byte PKCS#8 private-key envelope protected by Android Keystore. The WebCrypto interoperability fixture, JVM regressions and required Android native jobs passed #4106's exact-HEAD CI. No physical-device acceptance is claimed.
