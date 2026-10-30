# Administrator Server backup snapshot index pagination

This is **read-only discovery and bounded verification admission**. A snapshot ID is never a restore, drill, prune or delete capability. Only the latest 100 Host-attested full inventory entries retain those separately guarded administrative actions.

## Host index protocols and coverage

The Host Control process discovers canonical local `v1`, `v2-default` and configured `v2-configured` snapshots from three fixed, Host-owned roots. It sorts their identity tuples once per inventory generation, then publishes an atomic private `backup-admin-snapshot-index.json` next to the normal newest-100 inventory.

- Legacy Host protocol `xdrive-backup-snapshot-index-v1`: at most **1,000** ordered IDs.
- New Host protocol `xdrive-backup-snapshot-index-v2`: at most **10,000** ordered IDs.
- Both declare the **actual full total** (up to 1,000,000), `indexed_snapshots`, `truncated`, fresh `generated_at`, and the exact 64-character policy revision.
- New Host output remains bounded to 1 MiB. It fails closed on malformed, duplicate or unordered identities, source cardinality mismatch, or unsafe index inode. The v2 cap does not imply every backup beyond 10,000 has been inspected.
- **No additional Host path, database field, raw file digest, credential or backup data** enters this index.

The Server accepts both protocols, verifying the per-version index cap, complete indexed count, strict reverse order, distinct canonical IDs, policy revision, recent timestamps, and exact agreement with the full metadata of the newest 100. A missing, stale, symlinked, mismatched or oversized index is unavailable, not a valid empty backup library. Older Server versions may temporarily reject the new v2 index until upgraded; this is a read-only UI compatibility limitation, not permission to bypass verification.

## Authenticated read-only pagination

```http
GET /api/v1/admin/backups/snapshots?offset=100&limit=50
```

Only canonical bounded decimal offsets (0–10,000) and limits (1–100) are accepted. The response retains the existing `xdrive-backup-snapshot-page-v1` / `unverified_identity_only` contract so the same Web, Desktop and DSM page renderer can support old and new Host index generations.

The shared UI starts at identity 101 and loads a maximum of 50 IDs per request on demand. It shows the *real* `indexed_snapshots` and `total_snapshots` counts. When truncated it explicitly warns that older generations exist but are **not** indexed. An offset at the truncated boundary fails with `backup_snapshot_index_truncated`; it is never represented as a successful end-of-results page.

Each old identity may be submitted **only** to the existing administrator `verify` action after the Server rereads a fresh, matching Host index. The Host independently resolves its own fixed namespace and performs the actual verification; historical receipts do not grant ongoing integrity or recoverability. No older identity can be sent directly to destructive restore/delete/drill/prune from the index page. These actions remain gated by trusted newest-100 metadata, separate Host checks, and typed confirmations.

## Validation and remaining limits

The Host test checks both an actual >1,000 snapshot inventory and a synthetic 10,005-entry stream without writing ten thousand directories. API tests retain **legacy v1 1,000-entry** behavior, cover the v2 10,000-entry limit, offset boundaries, read-only older verification, rejected destructive actions and tampered indices.

The new cap remains intentionally finite to protect the always-on Host process and Server/Agent memory. Fully unbounded cursor-based snapshot discovery, safe destructive management of older generations, and new repository registration are separate P1 work; this feature does not change the underlying immutable backups, scheduling, retention, CAS GC, compression or Pack.

Unavailable production-only acceptance is **按用户决定跳过（未验收）**; source-level security and exact-head CI are not bypassed.
