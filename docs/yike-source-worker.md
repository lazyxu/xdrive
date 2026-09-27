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

Canonical scan paths are independent of album membership:

```text
Library/<sanitized-name> [<fsid>]
Shared/<owner_uk>/<sanitized-name> [<fsid>]
```

The fsid suffix makes names deterministic and collision-safe. Names are sanitized to xDrive's Windows-compatible namespace.

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
- `remote_created_at`: remote creation time;
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
  "target_node_id": 0,
  "ignore_rules": ""
}
```

The Source remains paused and has no target until its Cookie is validated. On the first successful credential write, xDrive reads the Yike `youa_id` and nickname and atomically creates/binds:

```text
来源/
└─ 一刻相册/
   └─ uid_<百度UID>_<账号名称>/
```

For example: `来源/一刻相册/uid_12345_张三/`. Invalid filename characters in the account name are replaced safely. This hierarchy exists only in `xd_nodes`; file content still uses xDrive's content-addressed storage (CAS), so the managed folder does not duplicate physical blobs or change deduplication semantics. The target cannot be changed through the Source update API.

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

The response contains only credential status metadata. The Cookie is encrypted with the versioned connector keyring and is never returned by GET. For a new Yike Source, target-directory creation, Source binding/activation, and encrypted credential persistence occur in one database transaction. Clearing the Cookie automatically pauses the Source and clears any pending manual request; storing a new valid Cookie for the same UID reactivates it and keeps the existing managed target. Once media has been imported, a Cookie belonging to a different UID is rejected.

## Worker schedule

Docker Compose runs a separate `worker` service from the same server image.

The worker checks for due Sources on startup and then every:

```text
XD_SOURCE_WORKER_POLL_INTERVAL=1m
```

A Source is actually scanned only when its previous `LastRunAt` is older than:

```text
XD_SOURCE_PULL_INTERVAL=6h
```

This prevents container restarts from triggering repeated full-library scans against the private Yike API. Use `xdrive-server worker --once` for an intentional immediate scan of all eligible Sources.

The minimum accepted interval is one minute. The default is intentionally conservative because Yike discovery uses a private API and each run performs a full reconciliation scan.

Read-only Yike API GETs use bounded transient retries: at most three attempts for transport failures, HTTP 429, and HTTP 5xx responses. Backoff starts at 500 ms; a valid `Retry-After` header is preferred when it is at most 30 seconds. Longer rate-limit delays are returned to the Source run instead of blocking the single Pull worker. Authentication failures and Yike business-level errno responses are not retried.

The worker schedules active, credentialed:

```text
kind=yike_photos
direction=pull
sync_mode=backup
run_mode=scan|sync
```

Sources. `scan` never opens media download streams. `sync` executes the same planner output through the Source execution-commit protocol.

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

For `run_mode=sync`, create/update candidates are streamed directly:

```text
Yike dlink
  -> HTTP Range stream
  -> 8 MiB xDrive upload chunks
  -> CAS/finalize
  -> Source /commit
```

The worker does not download the complete media object to a temporary file. The upload resume key is derived from the stable external ID plus size, modified time, and remote revision, so a restarted worker can reuse chunks already accepted by xDrive. Each remote stream re-acquires a fresh Yike download link before opening, which avoids depending on an expired dlink.

Media downloads have no fixed total-file deadline, so large or slow files can continue for as long as data is making progress. The connector does enforce a 30-second response-header timeout and a 60-second read-idle watchdog; a connection that stops producing bytes is cancelled and recorded as a per-item failure, then retried on a later Source run.

Pure `move` plans rename/move the existing xDrive Node without downloading content. `move_update` moves the Node first and then overwrites it through the resumable stream path.

Shared media uses the read-only direct album download endpoint. If that direct link is unavailable, only that item remains pending and the run becomes `partial`; other media continue. xDrive never calls Yike `copyfile`, `addfile`, delete, or other mutation endpoints to make a shared item downloadable.

Actual `TransferredBytes` counts only chunks newly accepted by xDrive. Scan mode reports planned transfer bytes only.
