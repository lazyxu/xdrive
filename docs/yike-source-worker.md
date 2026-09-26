# Yike Photos pull worker

Yike Photos support is experimental because it relies on the current private Web API used by third-party integrations rather than a documented public API.

## Scope

Phase 13D3 is **scan-only**. The worker discovers and plans Yike content but does not download media.

It covers:

- the account root photo library;
- the account's own albums;
- joined/shared albums returned by the album API;
- gitignore-style Source ignore rules;
- deterministic SourceItem identity;
- scan statistics and missing detection;
- encrypted Cookie storage through the Source Credential Keyring.

It intentionally does **not**:

- upload, copy, delete, rename, join, or otherwise mutate Yike;
- call media download/link endpoints during a scan;
- create duplicate xDrive files for album memberships;
- execute Source `run_mode=sync`.

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

Album/collection metadata is deferred to Phase 13E.

## Configure a Source

Create one xDrive target directory first, then create a Source using the existing Source API:

```json
{
  "name": "Yike Photos",
  "kind": "yike_photos",
  "direction": "pull",
  "sync_mode": "backup",
  "run_mode": "scan",
  "target_node_id": 123,
  "ignore_rules": ""
}
```

The first version supports only `backup` semantics. A media object that disappears from Yike becomes `missing`; its xDrive data is never deleted or trashed.

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

The response contains only credential status metadata. The Cookie is encrypted with the versioned connector keyring and is never returned by GET.

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

The worker only schedules active, credentialed:

```text
kind=yike_photos
direction=pull
sync_mode=backup
```

Sources. A Yike Source already switched to `run_mode=sync` is skipped until the Pull executor is implemented.

For a manual one-shot scan inside the worker container:

```bash
docker compose --env-file ~/.xd/.env -f ~/.xd/docker-compose.yml \
  exec -T worker xdrive-server worker --once
```

## Safety

The worker is a trusted internal service. It reads encrypted connector credentials from PostgreSQL and uses the connector keyring to decrypt them. It does **not** duplicate Source run transaction logic. Instead, for each Source owner it creates a short-lived internal access token carrying the current SessionVersion and calls the existing Source `begin/observe/heartbeat/finish` API over the Compose network.

This means Synology Push and Yike Pull share the same planner, ignore, missing, stale-run, target-snapshot, and statistics semantics.

If any part of the remote inventory cannot be completed, the run finishes failed/cancelled with `complete_inventory=false`. Missing inference therefore never runs on a partial Yike traversal.
