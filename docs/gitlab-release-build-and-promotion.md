# GitLab source-exact release pipeline

## Ownership and network boundary

GitHub Actions owns PR testing, merge acceptance and the exact stable-tag Final Gate.
GitLab **compiles all published binaries and images itself** from the GitLab checkout.
No release Job downloads executable or Docker artifacts from GitHub Actions or GitHub
Releases. GitLab Registry/Package Registry are the local publication transport.

The source ref is the full `CI_COMMIT_SHA` in every builder, image label,
staging manifest and release manifest. GitLab cannot fabricate a build from a
different commit and label it as the selected source commit.

## Master rolling Snapshot DAG

- Web builds both `web/dist` and the DSM-specific `web/dist-synology` from
  one `npm ci` and exact source revision; the Go core builder packages the latter.
- Desktop Linux/Windows, Go core, Server and Caddy build in parallel where
  their actual `needs` permit. Linux and Windows installers consume their exact
  CI-produced runtimes and Go binaries. Go caches modules **and** compiled
  objects; Node/Electron cache their runtime downloads and package tarballs.
- Each Docker builder verifies the expected version and full Git commit label,
  then pushes to an **ephemeral per Pipeline/Job** `ci-<pipeline>-<job>` Registry
  tag. The build artifact contains only the staging reference, content digest,
  Docker image ID and full commit: no massive `docker save` archive is shipped
  between Runners.
- `publish-server-images` pulls the two staged core images **by digest**,
  checks image ID, version and full commit, and publishes immutable version
  tags. A conflicting already-published tag fails closed rather than replacing
  different bytes.
- `promote-server-images` checks **all** existing mutable `edge` target
  revisions before writing any target tag. A target from a newer, unknown or
  divergent commit blocks promotion; only an ancestor or equal commit is
  accepted. Registry timeouts and authorization errors are never treated as
  "tag absent". The first upgrade of an old Caddy image without a revision
  label is allowed only when its Server `edge` was already verified.
- `publish-release` consumes the current CI's verified two-image digest
  manifest plus exact CLI, Windows EXE, Linux DEB and DSM SPK artifacts, then
  stages SHA-256 verified GitLab Packages and updates the Snapshot Release.
  Existing GitLab Release links retain their rollback protections.
  Immediately before publishing Release links, a dedicated verifier requires
  exactly four records (full Commit, channel, Server image, Caddy image) in the
  CI-produced manifest; both fully qualified refs and 64-byte SHA256 digests
  must be exact, unique, ordered and valid. A duplicate or malformed image
  record fails closed, even when its Commit header matches.


**Optional services:** Photo Face and Media Worker are outside the rolling
Snapshot's core dependency graph. Each is built and published only after
relevant source changes and can fail without withholding Server/Client updates.
Their independent `edge` tags have the same descendant-only guard. Their
Commit labels can be different from a newer Server Snapshot by design; do not
treat an optional service image as proof of the Server's full commit.

**Installer compatibility with independent optional images:** GitLab master
upgrades retain existing immutable `XD_PHOTO_FACE_IMAGE` and
`XD_MEDIA_WORKER_IMAGE` references (full manifest digest, 12-hex immutable
Snapshot tag, or formal `v*` tag), instead of inventing the core
`sha-<new-server-commit>` for these services. The core Server+Caddy and
client artifacts **still must match the release Commit**. Mutable/unknown
existing optional tags fail closed rather than being silently substituted.
Existing **enabled** optional services therefore stay on their explicit
prior version until they are updated separately with compatibility checks.
**Disabled** optional profiles are not consulted for core upgrade eligibility:
an old `latest` image value in an inactive profile will not block a
Server/Caddy update. Its selected inactive reference may be rewritten to the
new release's source tag; enabling that service later must explicitly verify
and install a compatible published optional image. A fresh install with
optional profiles enabled still needs an exact-Commit optional artifact.
Stable releases and offline packages retain their existing exact-version
behavior. This preserves active optional services without making a very
large optional model download part of the Server's publication dependency.

**Stable `v*` tags:** Every core and optional image must be independently
rebuilt from the tag's exact commit, pass GitHub's exact-tag Final Gate before
the public version tag is pushed, and finish all required publish jobs before
the final Release appears. No partial stable Release is allowed.

## Stable pre-stage publication gate

The Registry may expose even temporary `ci-<pipeline>-<job>` image tags to
readers. Thus `v*` stable image **builders**, including Photo Face's
long-lived model runtime cache uploads, first require the exact tag/Commit
GitHub Final Gate to succeed. The staging helper checks again immediately
before the first upload, and immutable tag publishing/promoting repeats
the gate before public stable tags. No Release job depends on GitHub binary
artifact downloads; these are CI verdict checks only. Master CI stays
independent of stable-tag preflight.

## Cache and Runner queue policy

Normal master builders are interruptible, so superseded builds may be cancelled
before publication. Stable-tag builders are not interruptible. Once a publish
or promotion Job begins, it is noninterruptible; resource groups serialize
Registry mutations, not expensive build/model downloads. Promotion validates
remote history while holding the relevant resource lock, preventing older
completed builds from overwriting a newer `edge`.

Photo Face caches downloaded/resumable model inputs in the GitLab cache and
stores the *verified* dependency+model runtime in GitLab Registry under a
runtime-contract hash. On a new Runner, it restores the runtime from the
Registry and runs the same dependency/contract probes before using it. The
per-commit analyzer business layer is always rebuilt; a mismatched cached
runtime is rejected, not silently used.

The Registry's `ci-*` stage tags can be expired by a **separate GitLab Registry
retention policy**, but publication must never delete still-referenced digest
objects. Retain immutable version and promoted tags. Registry cache/staging
availability is a GitLab responsibility; GitHub binary hosting is not in the
publication data path.

## Regression contract

GitHub CI runs `test-gitlab-master-release-interrupt.py`,
`test-gitlab-master-publish-before-tests.py` and
`test-gitlab-registry-release.sh` alongside the existing snapshot package
and Photo Face runtime cache tests. The new tests exercise:
stale/foreign history, a missing image revision, Registry outage, a legacy
Caddy migration, immutable-tag conflict and successful cold promotion.
Actual Registry access, Windows signing and final GitLab Runner behavior
still require the exact PR CI and production publication acceptance checks.
