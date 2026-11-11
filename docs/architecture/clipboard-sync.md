# xDrive Clipboard — current plaintext design

**Current source status (2026-11-11):** [#4262](https://github.com/lazyxu/xdrive/pull/4262) and the DSM allowlist cleanup [#4285](https://github.com/lazyxu/xdrive/pull/4285) have **merged into `master`**. Clipboard is a single **plaintext Owner-scoped mailbox** on Server, with no separate unlock or E2EE. Prior #4124 E2EE behavior is historical, not a current product requirement. Future Clipboard changes are validated through the applicable repository tests, CI and exact-HEAD Final Gate specified in `AGENTS.md`.

## Product behavior

Clipboard is a short-lived cross-device channel for manual text and links and directed references to existing Files/CAS nodes. A signed-in user can use it **immediately with no separate unlock, password or key exchange**. Every message has a UUID client_event_id, kind, UTF-8 `content`, optional target_device_id and optional node_id, creation time, and expiry time.

- Broadcast text/links: `POST /api/v1/clipboard/items` with `client_event_id`, `kind` (`text/plain` or `text/uri-list`) and `content`. Signed-in Owner clients retrieve shared recent history.
- Directed text/links: same plaintext fields plus a registered `target_device_id`. The Owner bearer may send, but reading directed messages also requires a live registered, separately authorized DeviceIdentity proof.
- Directed file or image reference: `kind` is `image/x-xdrive-node-ref` or `application/x-xdrive-node-ref`, `node_id` is the existing authorized Node, and `content` must equal `asset:<node_id>`. This message **does not grant new Files access**. A Viewer click resolves and revalidates the current Owner, Node location, revision, original and Files permissions.
- Optional local file import uploads a normal Owner File through the existing UploadSession/CAS writer; a separate explicit action sends its reference. No secondary Clipboard binary store or generic transport.
- An unknown send ACK retains the same event ID, payload, kind, Node and target for at most five minutes; conflicting retries do not silently duplicate or retarget a message.
- Server retains up to 50 valid items for 24 hours; per-Owner SSE transports only invalidation cursors and clients reconcile with authenticated GET. No clipboard message content goes into SSE frames.

## Security, privacy and limitations

**Clipboard content is not end-to-end encrypted. Server stores plaintext and administrators with database access can read it.** UI must warn against sending passwords, OTP codes or sensitive secrets. This deliberately removes the separate Clipboard passphrase, unlock/lock buttons, PBKDF2/AES payload encryption, local device E2EE private keys, key wrapping, vault salt/verifier and decrypt APIs. This decision **does not** remove HTTPS/TLS transport, account passwords, session authentication, OS-level keychain protection for other services, or authorization of devices.

Only the current revocable Owner session can use the API; SourceRun, Photo backup, public-share and generic Agent credentials do not inherit Clipboard permissions. Directed delivery requires an enrolled installation identity and Clipboard grant; device revocation and Owner/session changes invalidate future access. HTTP responses are `Cache-Control: no-store`; redirects and unauthenticated Owner/Device requests fail closed. Data copied to an OS pasteboard cannot be remotely revoked.

On mobile, read/write of the OS clipboard requires explicit user interaction; no continuous background pasteboard observer. Desktop's system clipboard watcher is optional and **off by default**; when explicitly enabled it runs only for the visible Clipboard page, with session/Owner cancellation. Web/PWA never silently monitors the browser clipboard. The iOS Share Extension copies selected text/links to a **local-only OS pasteboard for two minutes**, followed by xDrive → 剪贴板 → 从本机粘贴 → 发送. For one image/file (up to 64 MiB) it copies bytes plus a bounded name/type under private pasteboard types; the native screen requires an explicit **从分享内容导入** action, reuses the existing verified Files UploadSession/CAS writer, and then requires a separate directed **发送**. The extension never silently sends or stores Owner credentials.

Older encrypted Clipboard records do not become readable plaintext by changing the API. Legacy ciphertext rows must not be sent as text or shown in the new mailbox. There is no production data migration requirement for this project.

## Implementation boundaries

- Server: `internal/api/clipboard.go`, `internal/api/clipboard_extended.go`, `internal/meta/clipboard.go`. The existing schema may temporarily retain legacy column names while new API fields are `content` and no encryption parameters appear on the wire.
- Web/PWA: `ui/shared/src/mui/ClipboardPage.tsx`, `web/src/clipboardDataPort.ts`, `web/src/api.ts`. User-gesture clipboard images support PNG/JPEG/WebP/GIF/AVIF/HEIC/HEIF where the browser exposes these types. Local uploads reuse Files/CAS and Server Owner limits, without a separate Clipboard 64 MiB cap.
- Desktop: `desktop/src/renderer/desktopClipboardDataPort.ts`, restricted Agent IPC, existing Files root/paged read and UploadSession/CAS file writer. User-gesture local imports; Agent relays authenticated Server SSE **cursor-only** changes, with 1.8 s foreground poll and 15 s full GET fallback. No Browser vault, private key export or general OS clipboard proxy.
- DSM: `web/src/synologyClipboardPort.ts`, same-origin CGI and Agent Owner Files root/paged read. For files up to 4 MiB, preserve the existing small-file CAS writer; larger files use bounded 4 MiB segments through the **same Server UploadSession/PutUploadChunk/FinalizeUpload** writer. The browser sees only Session ID and validated Node receipts, never the Server bearer. The authenticated Agent subscribes to Owner SSE change cursors, with 1.8 s foreground poll and 15 s full GET fallback on unavailable transport.
- iOS/Android: native Clipboard pages using verified Owner bearer, explicit installed-device enrollment, directed content, CAS and existing Viewer.

## Automated validation contract

1. All platforms show Clipboard immediately without any independent passphrase, unlock or encryption claim; send/list/copy/delete/clear work.
2. Text, URL, image/file Node references and direct-to-device messages use exactly the `content` wire contract, not `nonce`, `ciphertext`, wrapped or public keys.
3. Owner A cannot access Owner B's content, even after A→B→A, logout/login, revoke, password reset or delayed responses. Device X cannot read content directed to device Y; a revoked device loses access.
4. Unknown ACK retries preserve EventID/target/MIME/Node and a changed intent is rejected. Cross-Owner and trashed/foreign Files Nodes cannot be sent or opened.
5. SSE contains only change cursors; connection loss falls back to full GET; pages do not monitor OS clipboard in background; the user explicitly confirms local uploads and viewer opening.
6. Run the applicable Go/PostgreSQL, Web/PWA, Desktop, native iOS/Android, DSM and security regressions in available automated environments. The exact PR HEAD must pass required CI and Final Gate before merge.

The older implementation's crypto benchmark vectors and passphrase recovery discussions are retired historical fixtures, not current feature documentation.
