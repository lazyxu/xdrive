# L03-F2d8c3b2q — private durable, one-use advisory challenge

**Status:** internal PostgreSQL precondition only; not an operable Local Push executor. Previous #1904 established a scoped, time-limited native-directory advisory HMAC. This phase persists a single outstanding challenge *digest* per `local_folder` Source and atomically consumes it; it cannot authorize uploading, committing, deleting, or declaring a backup complete.

## Scope, storage, and authentication

- The private Server issuer is a Go method only. It requires the existing Gin authenticated Owner and exact owning device/Root/Source revision proof. Inside a single PostgreSQL transaction it locks Owner (SHARE), Device (UPDATE), Source (UPDATE), Root binding (SHARE), checks a live authorized target, and only then locks the Source's challenge row (UPDATE). Never trust a browser label or same-account second Desktop.
- An issued challenge is 32 unpredictable bytes with at most a two-minute lifetime, minted using the PostgreSQL clock. Exactly ONE challenge row exists per Source. The row stores Owner, session version, Source revision, target Node, Device UUID, Root UUID/fingerprint, state, issued/expiry timestamps and **SHA-256 of the nonce**. It does not store the raw nonce, Agent token, native item identity/path, HMAC tag, original bytes or a user-visible filename.
- Issuing another challenge while the first is live is denied; a consumed or expired record may be replaced only by an explicit authenticated operation. Reissue invalidates the previous nonce even if a late client retries it.
- Consumption, through a separate private Go method, performs the same current Owner/Device/Source/Root/target checks under transaction locks, compares every challenge field and current session version with the row, uses **PostgreSQL DB time** for the expiry window, verifies the private observation HMAC with the *currently authenticated* device credential, then updates only `state=consumed` and `consumed_at` with compare-and-swap semantics. A second replica/replayed request cannot consume it twice.
- Device credential rotation/revocation, Root replacement, Source revision/target edit, account session rotation, forged Owner/nonce/tag and cancellation fail closed. A consumed challenge is not a backup receipt.

## Hard activation boundary

There is **NO** new HTTP API route, Agent IPC, Electron Main/Preload/Renderer, Web/Mobile Web, scheduler or production caller. The two private Go functions are deliberately not wired to the existing CI-only one-directory writer. `local_folder` activation and SourceRun stay denied, the existing Stage ceiling remains 64 MiB, and Mirror missing inference/delete remains off. A valid HMAC and atomic one-time consumption authenticate private metadata, **not a live OS handle** across SQL or an untampered native directory. A stolen/compromised device token does not yield trustworthy hardware attestation. Future work must safely pin/recheck the current native directory through an explicit transport/lifetime contract while committing SQL, with crash-safe replay and fail-closed revocation, before any user-visible backup controls.

## Tests and gates

Go API integration uses an isolated real PostgreSQL schema with two independent connection pools, verified owning Source/Device/Root fixtures, concurrent 12-way consumption, replay/reissue, forged Owner/Root/credential/nonce/MAC, device revoke, Source revision and target drift, session rotation, DB expiration and canceled context. Assert schema excludes private raw material and no SourceItem/Node/SyncRun is produced. Tests skip without `XD_TEST_DATABASE_URL`; only exact-HEAD GitHub Go Linux/API PostgreSQL Race, Go Windows, Desktop/Web, images/artifacts, single-commit and `final-gate` CI can authorize a Ready/Rebase merge. Physical Windows/Linux installed Desktop 100k / ≥4 GiB and real completed backups remain unverified.

**Next:** separate scoped native-lifetime proof/Server transaction commit, then the durable Runner/SourceRun and cancellation/recovery stages. Do not turn a challenge row or its terminal consumed state into `SourceItemStateSynced` or a cloud deletion signal.
