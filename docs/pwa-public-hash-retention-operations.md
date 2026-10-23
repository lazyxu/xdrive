# PWA public hashed assets · conservative retention & capacity operations

Status: 2026-10-23. Resolves the product-policy portion of P1-04 and P2-03.
The public archive is APPEND-ONLY and all historical hashed JS/CSS/assets
remain addressable for an indefinitely inactive installed PWA or rollback.
No TTL, last-access cutoff, idle-client heuristic, manifest absence, or
percentage-based retention rule may automatically delete an asset.

## Durable contract

- `deploy/pwa-archive-assets.sh` publishes a previously missing hash with
  an atomic hard link; same-name different bytes are rejected. Current and
  historical versions coexist. No source or archive symlink is accepted.
- `scripts/pwa-archive-reference-audit.mjs` is READ ONLY. Its
  `known_manifest_count` counts only explicitly supplied manifests; even
  a 0-reference old hash is NOT a proven idle client, GC candidate, or
  a safe deletion signal. `safe_to_auto_delete` remains false.
- The installed PWA's active Service Worker, still-open HTML document,
  stale JS module loader and disconnected mobile client cannot be enumerated
  conclusively from a server inventory. Unknown is a retention obligation.
- Browser CacheStorage may hold only already allowed PUBLIC app-shell
  content. No Owner API, thumbnails, originals, tokens, tickets or Range
  may enter an archive or Service Worker cache.

## Read-only capacity check

On a trusted instance or isolated test fixture, supply an explicitly chosen
public archive directory and known old/new `.vite/manifest.json` files:

```sh
node scripts/pwa-archive-reference-audit.mjs \
  "$XD_CADDY_ASSET_DIR" \
  /path/to/old/dist/.vite/manifest.json \
  /path/to/new/dist/.vite/manifest.json \
  --soft-limit-bytes=536870912
node --test desktop/tests/pwa-archive-reference-audit.cjs
```

The soft-limit comparison uses inode-unique bytes, NOT exact physical disk
usage, and MUST NOT run a cleaner. Record run time, exact deployed release
SHAs, which manifests were supplied, audit schema, archive file/byte
counts, missing references and the configured threshold. Do not archive
personal file paths, actual domain, JWT/Cookie, media or signed tickets.

If `missing_referenced_files` is nonzero: classify as release-integrity
failure, preserve the current archive, recover the exact historically
published immutable bytes from a trusted build artifact, verify hashes
and retest upgrade/rollback; NEVER generate a replacement file under
the old hash name.

If `soft_limit_exceeded` is true: flag operator capacity planning,
review the separately mounted public archive budget and increase/migrate
storage while retaining exactly the same public URL bytes. Never infer
space savings from removing unreferenced manifests; do not touch CAS,
private metadata, Gallery resources or active transfers.

## Final safe-retirement decision

`safe_to_auto_delete=false` and `delete_candidates_established=false`
are the shipping behavior, not a missing automatic task. There is
currently NO proof for every dormant client, so NO old public hash
is allowed to be retired by automation. A future operator-requested
irreversible cleanup requires a new explicit product decision, separate
security analysis, multi-generation real browser/rollback tests and
an operator-confirmed plan. This policy does not imply data is safe to
remove after 7, 30 or 90 days.

Actual iOS/Android physical install and inaccessible production-only
safety acceptance remain NOT RUN / 按用户决定跳过（未验收） as applicable;
source security, PWA rollback and append-only tests remain required.
