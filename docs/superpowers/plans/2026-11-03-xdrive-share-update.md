# xDrive Share update implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute the tasks without further design questions; the owner requested complete delivery and delegated configuration.

**Goal:** Publish exact GitHub master offline packages to the owner's Share and successfully run `xdrive-server update --source xdrive --channel master` on the existing host.

**Architecture:** Keep GitHub as publisher authority and add a Share transport around the five-component offline installer from #3625. Verify an attested delivery descriptor with pinned Sigstore trust before downloading/executing packages, then reuse the existing transactional installer.

**Tech Stack:** Python standard library, Bash host manager, GitHub Actions attestations and GitHub CLI, existing xDrive Share APIs.

**Spec:** GitHub Issue #3664 and the owner's current request; #3625 provides the offline engine. Server CLI delivery is first; other client selectors remain separate unfinished scope.

## Global constraints

- Repository identity is `lazyxu/xdrive`, numeric ID `1382670236`; only `master`, `linux/amd64` initially.
- Keep public consumer Share read-only and publisher `view_upload` private. Never print or commit capability URLs/passwords.
- All bytes must be staged and verified before maintenance. No registry pulls or Share access after stopping Server/Caddy.
- Existing GitHub/GitLab behavior, backups, Owner isolation and rollback remain mandatory. Exact applicable CI/Final Gate precedes merges.
- Temporary data must be on D; use an isolated worktree and leave other work unchanged.
- Signed manifest `source=github` means provenance; distribution preference `xdrive` is separate.
- Upload initialization carries SHA-256 and size; a visible current file inside
  the same Share may produce a durable finalized receipt with zero chunks.
  Private files outside the Share and other Owners must remain ineligible.

## Review focus

- An authentic old release or same-generation conflicting identity must not roll the installation backward.
- Truncated, same-size modified, out-of-scope, redirected and duplicate-name Share resources must never execute.
- Existing optional profiles and exact image identities must survive an App-only update.
- Interrupted uploads must not make an incomplete release selectable.
- A failed upgrade must retain recoverable configuration and the original running installation.

## Task 1: repair the existing prerequisite

- [x] Reproduce/fix #3625 gofmt failure and enabled-profile preservation with regression tests; preserve original branch.
- [ ] Review, push one batch, require current-HEAD CI/Final Gate and merge only when all applicable gates pass.

## Task 2: provider transport and tests

Files: create `scripts/xdrive-share-update.py`, `scripts/test-xdrive-share-update.py`.

Interfaces: `Share` supplies bounded children pagination and same-origin HTTPS ticket downloads; `read_config(path)`, `verify_publisher(file,bundle,trust_root)`, `discover_release(share,floor)`, `download_verified_file(...)`, `run_offline_install(...)` provide the provider pipeline. CLI accepts `--config`, `--home`, `--channel master`, `--prefetch-only`, and `--backup-file-data`.

Descriptor `delivery.json`: schema 1, repository_id 1382670236, channel master, platform linux/amd64, source_commit full SHA, positive first-parent `sequence`, manifest and installer objects with name/sha256/size. Attestation file is `delivery-attestation.jsonl`. Verify repository, workflow `.github/workflows/offline-packages.yml`, master ref, hosted runner and numeric repository identity using local `gh` and provisioned trusted root.

Layout: `xDrive-Server/packages/<full-package-sha256>/<filename>` and `xDrive-Server/master/<sequence>-<full-source-sha>/`. Descriptor is uploaded last; packages and manifest immutable. Listing size alone is not integrity.

Config mode 0600: consumer URL/password, local verifier/trust-root paths and trusted initial sequence floor. Atomic high-water record binds sequence/source_commit/descriptor SHA; exact retry allowed, lower or conflicting sequence rejected. Metadata and traversal limits, disk space and package sizes are bounded. Never execute a downloaded installer before its hash is bound to the verified descriptor.

- [x] Write behavior tests for paging, tickets/password, redirects, hashes, signatures/publisher mismatch, replay/collision, incomplete selection, prefetch-only, and no execution until every required artifact verifies.
- [x] Observe failures, implement provider and run tests. Real local GitHub signature verification was exercised with a published Snapshot bundle and pinned trust root on Windows and network-disabled Linux; the first real offline-publisher bundle remains a deployment check.

## Task 3: publisher and release integration

Files: `scripts/ci/mirror-server-to-share.py`, tests, `.github/workflows/offline-packages.yml`, offline descriptor generator.

- [x] Generate descriptor using target master first-parent sequence, hash/size-bind existing manifest/installer, attest it using existing Actions trust.
- [x] Mirror exact published manifest/package bytes with existing Share upload protocol, rehash existing remote objects before reuse, upload descriptor last; fail missing or inconsistent packages.
- [x] Test interrupted publication, reused package corruption, duplicate path identities and publication ordering. Recover exact component and metadata drafts through authenticated GraphQL/REST identities before making them visible.

## Task 4: installed CLI and transactional preference

Files: host shell, offline installer, deployment asset manifests/copy/hash lists, component fingerprint, control/API source allowlists and their tests.

- [x] Route xdrive source to installed helper, reject stable, preserve existing providers.
- [x] Keep build provenance github; persist xdrive preference within existing backed-up install transaction. Forward file-data backup flag and preserve optional modules.
- [x] Include reader and offline-policy code in App fingerprints and verified deployment assets.
- [x] Run affected host, offline, installer and source/API contract tests; independent security review before PR. Legacy manifests remain readable for non-App reuse; new App packages and Share activation require the helper.

## Task 5: deployment evidence

- [ ] Configure private publisher Share/Actions secrets and read-only host config using authorized existing sessions.
- [ ] Wait for exact-head CI/Final Gate, merge, verify published artifact signatures and real Share byte round trip.
- [ ] Trusted SSH bootstrap accepted manager/helper/verifier; predownload; execute requested command during authorized maintenance, health/version/optional-module checks and rollback on failure.
- [ ] Record exact SHAs and actual results, distinguish skipped checks, remove only task-owned temporary data and stop follow-up only when goal achieved.
