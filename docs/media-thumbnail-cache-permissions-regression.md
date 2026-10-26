# Thumbnail/poster cache permission regression after root-to-user migration

## Root cause and impact

The runtime thumbnail handler first opens its versioned derivative under `.xdrive-media/thumbnails/<sha-prefix>/`; when missing/unreadable it renders the original and writes a new cached derivative via `storage.Local.Put`. A cold HTTP thumbnail request needs the complete directory chain to be owned by / writable for the Server runtime UID. Video posters share the same media cache root under `.xdrive-media/posters/`.

Before this change, `storage prepare` trusted an existing `.xdrive-uploads/.ownership-v1` marker for most storage paths. Follow-up fast-path repairs covered CAS parents and CAS lifecycle locks, but **not the existing media-cache parents**. A root-to-user migration or an older permissions incident could therefore leave the Server healthy (`storage.Local.Ready` probes only the root and upload-staging path) while cold thumbnail PUTs fail with `permission denied`. A previously inaccessible cache file can also be unreadable. The earlier Gen10 offline verifier error on `/data/.xdrive-media` is evidence of an access issue on that host, but does not on its own prove what every thumbnail HTTP request returned.

## Fix

Every `storage prepare` run, including those with a matching upload ownership marker, repairs **only existing directory metadata** for `.xdrive-media`, `thumbnails`, `posters`, each category's `node` directory and its 256 known SHA shards. This checks at most 517 fixed paths, independent of media count. It rejects symlinks/non-directories, does not recurse, and does **not** rewrite cache files, media metadata, canonical originals, CAS objects, other directories or credentials. Missing cache directories remain lazily creatable by the Server.

Photo thumbnails whose old cache files cannot be read are generated again on an authorized request, once the directory permissions permit atomic publication. Video posters remain separately produced by their existing uploader when absent; this patch does not add a new transcoder or unsafe fallback.

## Reproduction and regression

`TestPrepareStorageRootRepairsMediaCacheParentsWithCurrentMarker` reproduces this exact failure as a non-root Linux user: valid ownership marker, existing read-only media-cache SHA shard (mode `0100`), `NewLocal` succeeds, cold JPEG thumbnail PUT fails; after normal (non-force) prepare, the same JPEG writes and decodes, poster writes, and the existing cache inode/bytes and an unrelated directory remain unchanged. A second prepare is idempotent. `TestPrepareStorageRootRejectsSymlinkedMediaCacheParents` rejects symlinked root/category/shard paths without touching their targets.

Run from repository root:

```bash
go test ./cmd/server -run 'TestPrepareStorageRoot(RepairsMediaCacheParentsWithCurrentMarker|RejectsSymlinkedMediaCacheParents)' -count=1
XD_TEST_DATABASE_URL='<isolated-test-postgres-DSN>' go test ./internal/api -run '^TestMediaThumbnailColdCachePermissionFailureAndRetry

The Go tests are source-level regression evidence, not a claim of live Gen10 verification. For a deployed instance, independently inspect the authenticated `GET /api/v1/media/items/{id}/thumbnail?revision={revision}` status, Server error logs, and UID/GID/mode of the actual bind-mounted media-cache parents. After a new image has shipped, rerun its standard privileged `storage-init` service and request a cold thumbnail again. Do not delete original CAS data, disable cache verification or recursively change a large cache tree to diagnose this issue.
 -count=1
```

The API-level regression uses a real authorized Owner upload and JPEG-decoding thumbnail GET. It verifies that storage readiness passes with inaccessible cache parents, the first cold GET fails with an explicit non-cacheable 500 after locking the **leaf shard** (not just the traversable cache root), restoration permits the exact same versioned GET to return decodable bytes and a valid Content-Length, and a subsequently unreadable old cache file is atomically regenerated on the next GET. The test requires a dedicated disposable test PostgreSQL database and an unprivileged Linux runtime. It skips without those prerequisites.

The Go tests are source-level regression evidence, not a claim of live Gen10 verification. For a deployed instance, independently inspect the authenticated `GET /api/v1/media/items/{id}/thumbnail?revision={revision}` status, Server error logs, and UID/GID/mode of the actual bind-mounted media-cache parents. After a new image has shipped, rerun its standard privileged `storage-init` service and request a cold thumbnail again. Do not delete original CAS data, disable cache verification or recursively change a large cache tree to diagnose this issue.
