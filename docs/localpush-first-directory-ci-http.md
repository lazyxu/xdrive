# L03-F2d8c3b2n — CI-only authenticated first-directory SQL transaction

**Scope:** This is a test-only HTTP integration boundary for the already-private, one-level pending-directory writer. Previous stages #1879, #1886 and #1889 were merged. It does **not** make Desktop backup operational.

## Intent and protection

The existing Server-only commitBoundLocalPushFirstDirectory can atomically create one pending directory Node and corresponding SourceItem, but that internal primitive had no independent authenticated Gin HTTP test. This stage introduces a distinct, unexported, **false-by-default** Server boolean localPushCIOnlyFirstDirectory. Only the api test fixture sets that field directly; the normal production Router never registers the endpoint, and there is no configuration, environment variable, CLI, Desktop IPC, Web, or Agent path to enable it.

The test router alone provides POST /api/v1/sources/:id/ci-first-directory-commit. It requires current JWT, middleware authenticated owning Device token and bound Root ID/fingerprint, If-Match Source revision, exact one-component directory name, and strict 512-byte JSON containing only relative_directory. At the PostgreSQL mutation boundary, the existing private writer revalidates owning device, Root, Source revision, paused local_folder Push, target Node, collisions and idempotence. Repeated identical calls return the same pending Node/SourceItem, while revoked/foreign device, altered Source/Root/target, traversal, Windows-reserved names or malformed inputs fail without directory writes.

A successful CI-only response carries Source/revision, Node/SourceItem IDs, pending and replay state; all of native_verified, backup_complete, commit_supported, authoritative and missing_inference_safe are explicitly false. No sensitive local OS absolute path, credential, fingerprint or CAS hash is serialized.

## Verification and limitations

Real PostgreSQL/Gin integration verifies: route absent and HTTP 404 in the default Router; authenticated first creation and lost-response exact replay; pending-only SourceItem, no SourceRun/File/FileVersion, existing physical CAS and Source unchanged; malformed/overlong JSON, missing JWT or device credential, foreign device/Root, wrong revision, revoked device, changed Source and deleted target all fail. A Desktop source contract requires the zero-default conditional route and absence of any production caller.

**Important limitation:** A caller-supplied directory name and a valid device credential do not prove an actual native CURRENT directory. This CI fixture intentionally does NOT import the previously observed native CURRENT proof from #1886/#1889 as immutable SQL provenance. It never activates local_folder execution or marks a folder backed up. Cross-process original-to-Server commit authorization, signed/recoverable provenance, background Runner, SourceRun, recursive directories, large files, Mirror deletion and 100k/>=4GiB installed-client E2E remain separate blocked stages. The 64 MiB staging cap remains unchanged.

Require exactly one short-lived GitHub work commit on a fixed master baseline, complete exact-HEAD CI (Go Linux/API PostgreSQL Race, Windows, Web/Desktop, images/artifacts, single-commit and final-gate), then Ready/Rebase Merge and independent branch cleanup verification. No GitLab push or production activation is claimed.
