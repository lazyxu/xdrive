# Administrator Server backup snapshot index pagination

This feature extends **read-only discovery**, not restore authorization.

## Protocol and scope

The Host Control process still publishes its normal newest-100 backup inventory
with metadata and verification evidence. When there are more generations, it
also publishes a private, atomic `backup-admin-snapshot-index.json` with:

- `xdrive-backup-snapshot-index-v1` fixed protocol, fresh timestamp and exact
  backup policy revision;
- true total of all observed canonical local snapshots;
- at most 1,000 ordered, canonical `v1:`, `v2-default:` or `v2-configured:`
  IDs (no actual Host filesystem paths);
- explicit `truncated` when more than 1,000 generations exist.

The authenticated Server Admin endpoint is:

```http
GET /api/v1/admin/backups/snapshots?offset=100&limit=50
```

Only validated decimal offsets (0–1,000) and limits (1–100) are accepted.
The Server requires a live Host, a fresh inventory/index, policy-revision
agreement, exact newest-100 identity agreement and a strictly descending
unique list. The response contains `scope=unverified_identity_only` and
bounded page metadata. When the Host index is truncated, a request beyond its
coverage reports `backup_snapshot_index_truncated`; an older Host reports
`backup_snapshot_index_unavailable`. Neither is misreported as a successful
empty library.

## Shared UI / isolation

Web, Desktop and DSM use the same read-only React/MUI pager, shown only when
the Host-backed inventory reports more than 100 snapshots. The user starts at
snapshot 101; a page contains 50 identities. It is **lazy**: no extra Host
inspection runs on initial navigation. Requests are canceled logically on
Host/account/policy changes, so a late previous-owner response cannot replace
current UI state.

Older entries display only canonical identity and ordinal. There are no
buttons to verify, restore, delete or prune an older identity from this list.
Those actions remain independently gated by the existing Host-backed,
metadata-rich inventory and must never be inferred from names, counts,
successful historical checks, or an index timestamp.

## Limits and next phases

The 1,000-entry index is intentionally bounded to protect the 24×7 Host
Control process. This does **not** implement unbounded cursor pagination
across all snapshots, safe registration/migration of custom repositories or
destructive management of older generations. Extending these requires a
new Host-issued identity-plus-verification proof and independent exclusive
lock validation. Automatic v2 CAS GC and compression/Pack remain disabled.

Code/CI verification is required before merging. Production environment
acceptance remains **按用户决定跳过（未验收）** if unavailable, and must not
be confused with completed disaster-recovery proof.
