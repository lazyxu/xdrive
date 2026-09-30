# Yike Photos pull worker

Yike Photos support is experimental because it relies on the current private Web API used by third-party integrations rather than a documented public API.

## Scope

The worker supports both **scan** and **sync** Source modes.

It covers:

- the account root photo library;
- the account's own albums;
- joined/shared albums returned by the album API;
- gitignore-style Source ignore rules;
- deterministic SourceItem identity;
- scan statistics and missing detection;
- encrypted Cookie storage through the Source Credential Keyring;
- streaming media Pull into xDrive for `run_mode=sync`;
- resumable xDrive upload sessions without staging the whole remote file on worker disk.

It intentionally does **not**:

- upload, copy, delete, rename, join, or otherwise mutate Yike;
- copy shared-album media into the signed-in account as a download workaround;
- create duplicate xDrive files for album memberships.

## Source identity and deduplication

Yike media uses:

```text
yike:<owner_uk>:<fsid>
```

The account's `youa_id` is parsed as its owner UK. Album files use their own `uk` when present, which keeps shared-media identity separate from the signed-in account.

The root library is scanned first. Album membership is scanned afterward. If the same media identity is present in the root library and one or more albums, it is observed only once. Album membership therefore never creates duplicate SourceItems.

The Yike root library is user-visible as a flat media collection; the directory portion of the private API `path` is an internal Baidu/Yike namespace and is not reproduced as xDrive folders. xDrive prefers the newer file-list metadata that exposes `server_filename` (falling back to the compatible v1 list when necessary), then uses `server_filename`, `filename`, `name`, or finally the basename of `path` as the visible filename. It no longer invents `Library/` or `Shared/<owner_uk>/` prefixes and no longer appends `[fsid]` to every visible name.

For example, a Yike item reported as `path=/youa/web/1717120121000.png` with `server_filename=IMG_0001.png` is stored directly under the managed account folder as:

```text
IMG_0001.png
```

The stable `yike:<owner_uk>:<fsid>` identity remains internal. If two distinct remote items would map to the same case-insensitive xDrive filename, the first keeps the original visible name and only the conflicting item receives a deterministic ` (fsid)` suffix. This exceptional suffix is required because Windows/CfAPI cannot represent two siblings with the same case-insensitive name. Windows-reserved characters/names and overlong filenames are also minimally normalized. Legacy ignore rules that reference the former `Library/` or `Shared/<owner_uk>/` aliases continue to match internally even though those aliases are no longer visible.

Album metadata is persisted separately from media files. Each Yike album becomes one generic SourceCollection and membership is stored as a many-to-many relation to stable SourceItems. The same media object can therefore appear in multiple albums without creating duplicate xDrive Nodes or CAS objects.

Collection identity uses:

```text
yike:album:<album_id>
```

Album title/order/revision metadata is refreshed only after a complete remote album traversal succeeds. If an album disappears, its collection becomes `missing` and its membership rows are cleared; already imported media and xDrive Nodes remain untouched.

Read collection metadata through:

```http
GET /api/v1/sources/<source-id>/collections
GET /api/v1/sources/<source-id>/collections/<collection-id>/items?limit=200&offset=0
```

Use `?state=active` or `?state=missing` on the collection list when needed. Collection-item reads default to 200 rows and accept `limit=1..1000` plus a non-negative `offset`; the parent collection's `item_count` reports the total membership size.

## Read media metadata

Read all persisted SourceItems for this Yike Source through:

```http
GET /api/v1/sources/<source-id>/items?state=error&limit=200&offset=0
```

The endpoint is owner-scoped. `state` is optional and accepts `pending`, `synced`, `missing`, `ignored`, or `error`; pagination defaults to 200 rows, accepts `limit=1..1000`, and requires a non-negative `offset`. Error items include a bounded `last_error` and are automatically reconsidered on the next scan.

Each item returns the normal Source identity/state fields plus connector-neutral `metadata` when available:

- `original_path`: original remote path reported by Yike;
- `owner_external_id`: Yike owner UK for the media;
- `captured_at`: media capture time from Yike `shoot_time` when exposed;
- `remote_created_at`: remote creation/upload time from Yike `ctime`;
- `content_md5`: validated remote MD5 when exposed by Yike;
- `thumbnail_url`: refreshable preview hint from the latest scan;
- `pair_group_id` / `pair_role`: reserved explicit paired-media fields.

The same metadata object is included in collection-item reads. Missing media keeps its persisted metadata so history and album reconciliation remain inspectable. Current Yike list/album APIs do not expose a reliable Live Photo pair identifier, so pair fields stay empty instead of inferring relationships from filenames, timestamps, or neighboring JPG/MOV files.

## Configure a Source

Yike uses a server-managed xDrive **logical Node** target. Clients do not choose a target directory. Create the Source with `target_node_id=0`:

```json
{
  "name": "一刻相册",
  "kind": "yike_photos",
  "direction": "pull",
  "sync_mode": "backup",
  "run_mode": "scan",
  "schedule_type": "interval",
  "schedule_expression": "6h",
  "schedule_timezone": "",
  "target_node_id": 0,
  "ignore_rules": ""
}
```

The Source remains paused and has no target until its Cookie is validated. On the first successful credential write, xDrive reads the Yike `youa_id` and nickname and atomically creates/binds:

```text
同步文件夹/
└─ 一刻相册/
   └─ uid_<百度UID>_<账号名称>/
```

For example: `同步文件夹/一刻相册/uid_12345_张三/`. Invalid filename characters in the account name are replaced safely. This hierarchy exists only in `xd_nodes`; file content still uses xDrive's content-addressed storage (CAS), so the managed folder does not duplicate physical blobs or change deduplication semantics. The target cannot be changed through the Source update API. While a Yike Source is bound, ordinary file-manager rename/move/delete operations are also blocked for the target folder and its managed ancestors so the fixed hierarchy cannot be bypassed; media files inside the target remain normal nodes.

If a Yike Source was deleted while its imported folder was intentionally kept, re-adding the same account does not silently adopt files by name or size. Credential binding rejects a non-empty detached fixed target with `yike_target_contains_unmanaged_data`; move/archive that detached folder first, then add the Source again. This avoids treating unrelated user files as already-synchronized media.

The first version supports only `backup` semantics. A media object that disappears from Yike becomes `missing`; its xDrive data is never deleted or trashed.

## Test the Cookie

Web and Desktop can validate a Yike Cookie before it is persisted. The authenticated API is:

```http
POST /api/v1/source-credentials/test
Content-Type: application/json
Authorization: Bearer <xdrive-access-token>
```

with:

```json
{
  "kind": "yike_photos",
  "payload": {
    "cookie": "BDUSS=...; ..."
  }
}
```

The test is ephemeral: xDrive calls the read-only Yike user-info endpoint and does not write the supplied Cookie to PostgreSQL. A successful response may include the Yike account name and external account ID, but never returns the Cookie.

For an existing Source, the already encrypted credential can be tested without exposing it to the browser or Desktop renderer:

```http
POST /api/v1/sources/<source-id>/credential/test
Authorization: Bearer <xdrive-access-token>
```

Yike authentication, rate-limit, timeout, and service-unavailable failures are classified into stable error codes. Web/Desktop translate those codes into actionable Chinese messages, and the Pull worker stores the same classes as friendly Source errors such as “一刻相册登录已失效，请更新 Cookie”.

Creating a Yike Source and replacing its Cookie both validate the candidate Cookie before persisting it. The credential write endpoint also re-validates Yike candidates at the server persistence boundary, so callers cannot bypass the check by skipping the Web/Desktop “测试连接” step. A failed replacement leaves the previously encrypted credential unchanged.

## Store the Cookie

Submit the signed-in Yike Web Cookie once through:

```http
PUT /api/v1/sources/<source-id>/credential
Content-Type: application/json
Authorization: Bearer <xdrive-access-token>
```

Body:

```json
{
  "payload": {
    "cookie": "BDUSS=...; ..."
  }
}
```

The credential write response contains only status metadata. The Cookie is encrypted with the versioned connector keyring, and normal Source/credential GET responses never contain plaintext. For a new Yike Source, target-directory creation, Source binding/activation, and encrypted credential persistence occur in one database transaction. Clearing the Cookie automatically pauses the Source and clears any pending manual request; storing a new valid Cookie for the same UID reactivates it and keeps the existing managed target. Once media has been imported, a Cookie belonging to a different UID is rejected.
The Web/Desktop **同步文件夹** settings page shows the persisted target path returned by the server (for example `同步文件夹/一刻相册/uid_12345_张三`) as a read-only value. Ordinary settings saves do not rewrite this path. The managed hierarchy is checked or adjusted only as part of verified Yike account binding/rebinding.

A configured owner can explicitly inspect the stored Cookie through:

```http
POST /api/v1/sources/<source-id>/credential/reveal
Authorization: Bearer <xdrive-access-token>
```

The endpoint is not used during normal page loading. It returns only:

```json
{
  "field": "cookie",
  "value": "BDUSS=...; ...",
  "expires_in_seconds": 30
}
```

The response is marked `Cache-Control: no-store`, the reveal is audit-logged without the Cookie value, and another user cannot reveal the Source credential. Web/Desktop keep the plaintext only in renderer memory, automatically hide it after about 30 seconds, and clear it when the settings dialog closes. The revealed Cookie is deliberately separate from the **替换 Cookie** input and is never submitted merely because it was displayed.


## Worker schedule

Docker Compose runs a separate `worker` service from the same server image.

The worker checks for due Sources on startup and then every:

```text
XD_SOURCE_WORKER_POLL_INTERVAL=1m
```

Each Source owns its own persistent schedule. Web/Desktop can configure:

- `interval`, for example `30m`, `6h`, or `24h`;
- standard five-field `cron`, for example `0 3 * * *`, with an IANA timezone such as `Asia/Shanghai`;
- `manual`, which never becomes due from the worker poll and runs only after Web/Desktop **立即扫描** creates a pending manual request.

New Sources default to `interval=6h`. Older Sources created before per-Source scheduling may have empty schedule fields; only those legacy Sources fall back to:

```text
XD_SOURCE_PULL_INTERVAL=6h
```

The worker poll interval is only a lightweight wake-up cadence. A poll does not imply a Yike library scan: interval/cron Sources run only when their own schedule is due, while manual Sources stay idle until explicitly requested. A pending manual request always overrides interval/cron on the next poll. This also prevents container restarts from causing repeated full-library scans against the private Yike API.

The minimum interval is one minute. Use `xdrive-server worker --once` only for an intentional administrative run of all eligible active Sources.

The central Pull worker dispatches multiple due Sources with bounded source-level concurrency. The default is **2 active Sources** and can be configured with `XD_SOURCE_WORKER_CONCURRENCY` or `xdrive-server worker --concurrency N`; accepted values are 1 through 8. A pending manual **立即扫描** request is queued first, then due persisted retries, then ordinary scheduled work ordered by the oldest computed next-run time. Each Source still keeps its existing single transfer worker, and connector-specific request pacing (including Yike's 2 req/s control-plane limiter) remains independent of this global Source concurrency.

After the connector has exhausted its request-level retries, a Source-level failure classified as transient is persisted with exponential backoff starting around one minute and capped at 30 minutes. Rate-limit failures use a slower backoff starting around two minutes and capped at one hour. The deadline includes stable per-Source jitter and is stored in PostgreSQL, so restarting the worker does not reset the retry storm. Successful runs and non-retryable failures clear stale retry state. Sources configured with schedule type `manual` never auto-run because of retry state; **立即扫描** always remains an explicit override.

Read-only Yike private-API requests are globally paced per connector client with a built-in minimum interval of **500 ms** (about **2 requests/second**) so file pagination, album pagination, account checks, and download-link acquisition cannot burst concurrently. Transport failures and HTTP 5xx responses still use bounded transient retries with 500 ms exponential backoff. HTTP 429 prefers a valid `Retry-After` header when it is at most 30 seconds. Yike business errno `50005` (`操作过于频繁`) is treated as a rate-limit signal and retried within the same three-attempt budget with a slower 2 s then 4 s cooldown. Authentication failures and other business-level errno responses are not retried. Media byte streams themselves are not throttled by this control-plane limiter.

The worker schedules active, credentialed:

```text
kind=yike_photos
direction=pull
sync_mode=backup
run_mode=scan|sync
```

Sources. `scan` never opens media download streams. `sync` executes the same planner output through the Source execution-commit protocol.

While a run is active, each observation batch persists the current scan/planning summary, and resumable media uploads persist the active Source path plus current/total bytes. Web/Desktop poll that SyncRun and render live progress.

In `sync` mode, discovery/planning and transfer run as a bounded producer-consumer pipeline instead of blocking the remote traversal on every transfer batch. Sync planning defaults to 100 observed media items per batch, while scan-only mode keeps the 500-item batch. Each completed remote media page also flushes any partial sync batch before the next page is requested, so small libraries and short final pages begin transferring promptly instead of waiting for the next 100 items or end-of-scan. Planned transfers enter a bounded 64-item queue consumed by one transfer worker. The single worker preserves conservative Yike API pressure and the existing single-active-transfer UI while allowing the scanner to continue through later pages. Queue backpressure stops scan-ahead when transfers fall behind. A completed file is committed before the worker advances to the next file. Missing inference still runs only after the remote inventory completes and the transfer queue has drained. A user can request **停止**; xDrive stores `cancel_requested_at`, subsequent heartbeat/progress/observe/commit operations return a stable cancellation signal, and the worker cancels the run context so an active Range download/chunk upload stops promptly. The worker finalizes the run as `cancelled` with `complete_inventory=false`, so cancellation never triggers missing inference and is not counted as a file failure.

For a manual one-shot scan inside the worker container:

```bash
docker compose --env-file ~/.xd/.env -f ~/.xd/docker-compose.yml \
  exec -T worker xdrive-server worker --once
```

## V1 release acceptance

Before treating a build as release-ready for Yike Photos, run the real-account acceptance checklist in `docs/yike-v1-acceptance.md`. For a credential-safe protocol smoke test, export the Cookie only in the local process environment and run `scripts/test-yike-live.sh`; it performs read-only account/list/download-link requests and never mutates Yike.

## Safety

The worker is a trusted internal service. It reads encrypted connector credentials from PostgreSQL and uses the connector keyring to decrypt them. It does **not** duplicate Source run transaction logic. Instead, for each Source owner it creates a short-lived internal access token carrying the current SessionVersion and calls the existing Source `begin/observe/heartbeat/finish` API over the Compose network.

This means Synology Push and Yike Pull share the same planner, ignore, missing, stale-run, target-snapshot, and statistics semantics.

If any part of the remote inventory cannot be completed, the run finishes failed/cancelled with `complete_inventory=false`. Missing inference therefore never runs on an incomplete Yike traversal.

## Pull execution

For `run_mode=sync`, create/update candidates first offer Yike's canonical MD5 to the upload API. xDrive never trusts that digest by itself: the first transfer is assembled server-side while SHA256 and MD5 are both computed, and a reusable `MD5 + size -> SHA256` mapping is recorded only when the computed MD5 matches Yike's value. A later item for the same xDrive user can resolve that verified mapping to an already-owned healthy CAS blob and instant-attach it without requesting a Yike dlink or transferring media bytes. Digest mappings are owner-scoped; a cross-user digest value is never proof of possession. Conflicting verified mappings become `ambiguous` and are no longer eligible for instant reuse.

On a cache miss, the normal streaming path remains:

```text
Yike dlink
  -> HTTP Range stream
  -> 8 MiB xDrive upload chunks
  -> server verifies MD5 + SHA256
  -> CAS/finalize
  -> Source /commit
```

The worker does not download the complete media object to a temporary file. The upload resume key is derived from the stable external ID plus size, modified time, and remote revision, so a restarted worker can reuse chunks already accepted by xDrive. Each remote stream re-acquires a fresh Yike download link before opening, which avoids depending on an expired dlink.

Media downloads have no fixed total-file deadline, so large or slow files can continue for as long as data is making progress. The connector does enforce a 30-second response-header timeout and a 60-second read-idle watchdog; a connection that stops producing bytes is cancelled and recorded as a per-item failure, then retried on a later Source run.

Pure `move` plans rename/move the existing xDrive Node without downloading content. `move_update` moves the Node first and then overwrites it through the resumable stream path.

Shared media uses the read-only direct album download endpoint. If that direct link is unavailable, only that item remains pending and the run becomes `partial`; other media continue. xDrive never calls Yike `copyfile`, `addfile`, delete, or other mutation endpoints to make a shared item downloadable.

Actual `TransferredBytes` counts only chunks newly accepted by xDrive. A verified-MD5 CAS instant attach reports zero transferred bytes. Scan mode reports planned transfer bytes only.
