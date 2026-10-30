# v1 restore readiness — read-only CLI preflight

`server-restore.sh /absolute/v1-snapshot --preflight-only` performs the
**same bounded, fail-closed v1 preflight** used ahead of a real restore, then
exits before any production mutation.

The standalone tool runs:

1. Strict JSON manifest parsing using an O_NOFOLLOW regular-file read,
   bounded size, duplicate-key and unsafe-value rejection. Historical v1
   manifests without the optional `consistency_verified` field are permitted
   to be **inspected**, not claimed positively consistent. Explicit false
   source consistency is always rejected.
2. Full, exact SHA-256 checksum manifest comparison. Omissions, extra
   canonical entries and corrupted artifacts fail.
3. Full-file mode: bounded-memory tar **header** safety walk rejecting path
   traversal, duplicate aliases, unsafe links and special file types.
   Database-only mode skips the absent blobs.tar.
4. `pg_restore --list` in the existing tightly bounded, non-networked,
   read-only `postgres:17-alpine` container with `--pull never`. It can
   validate the custom dump TOC without connecting to production Postgres.

The result is a concise, nonsecret JSON receipt:

```json
{
  "protocol": "xdrive-v1-restore-readiness-v1",
  "state": "success",
  "scope": "manifest_sha256_tar_headers_pg_restore_toc",
  "format": "v1",
  "database_only": false,
  "full_restore_performed": false,
  "production_modified": false
}
```

For `--database-only`, scope is
`manifest_sha256_pg_restore_toc` and `database_only` is true. There is
**no isolated database instantiation, tar extraction, actual data recovery,
production verification or durable Host receipt**. The result does *not*
establish that a real restore will succeed. A later dedicated isolated v1
restore drill must independently prove actual files and PostgreSQL restoration
before receiving a "drill passed" label.

## Safety and operational limits

- `--preflight-only` is accepted for **v1 only**. v2 requires its
  CAS-aware verifier and separately bounded isolated drill.
- `--preflight-only` rejects `--yes` and `--no-safety-backup` to prevent
  confusing a read-only request with flags authorizing a destructive restore.
- It does not call Docker Compose, stop API/worker, start PostgreSQL,
  create a safety backup, or delete/rewrite snapshots.
- The `xdrive-server restore` wrapper distinguishes `--preflight-only` from a real restore: it does **not** record `system.restore success/failure` for an inspection. Real restore auditing remains unchanged.
- No administrator Web action or arbitrary Host path handling is added here.
  This is a local CLI building block; future Admin exposure requires the
  existing fixed Host namespace/Owner checks and an authenticated receipt.
- Missing local PostgreSQL image or Docker causes a failed/unknown result,
  never a false success. The image is not pulled automatically.

Regression in `scripts/test-server-v1-restore-preflight.sh` checks actual
non-networked PG TOC invocation and no other Docker operation, legacy DB-only
readiness, rejection of dangerous option combinations and v2 scope, in
addition to the existing corrupted manifest, checksum, tar and dump tests.

Production-only physical acceptance: **跳过（未验收）**. A passing CI
fixture is not a successful physical-device or real multi-terabyte recovery.
