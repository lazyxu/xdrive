# xDrive Commit-based Release Bundle (v1)

This protocol is **additive**. A Server release is never blocked by an
independently scheduled client-package cache and a client is **never forced**
to match the Server commit. Server update, backup, rollback and compatibility
checks remain authoritative.

## Identity and immutable publication

- A Bundle is identified by the **complete lowercase 40-hex Git Commit**,
  not by a rolling `snapshot`, 12-character prefix, build number or
  platform version string.
- An immutable GitHub Release `bundle-<full-sha>` publishes
  `release-bundle.json` and the exact same-commit client packages. Its
  publisher verifies the tag ref, every asset name and SHA-256 on retries.
  CI also produces a Sigstore attestation for the manifest.
- Artifact records include `platform`, `filename`, `build_commit`,
  `sha256`, `size`, `install_mode` and ordered preferred origins.
  **Missing platforms are omitted**. Android Debug APKs are never mirrored. Only independently approved,
  fixed-key signed public Android APKs may be included.
- Existing Linux/Windows/Backup CLI/DSM publish contracts remain in place;
  separately published iOS and signed Android outputs may enter a Bundle only when the
  exact-source Release is already present and verified at Bundle publication.
  A later native build does not mutate an existing immutable manifest.
- The existing GitHub/GitLab `snapshot` and stable channel releases are
  unchanged, so old clients retain compatibility.

## Noncritical Host worker

- The installed `release_bundle.py` worker starts after the Server's
  successful upgrade/health check/transaction commit. It also runs from the
  independent Host Control runner and is retryable by the admin.
- Host cache: `~/.xd/data/release-bundles/` by default. This is mounted
  read-only in the Server container at `/release-bundles`. The Host owns all
  writes. No Docker socket or privileged Host paths are served over HTTP.
- `manifests/<full-sha>.json`: immutable historical metadata retained;
  `current.json`: atomically published current cache identity;
  `packages/<current-sha>/`: only currently verified package bytes.
  On a failed new sync the previous verified cache remains available.
  `status.json` is separate from Server update status.
- During a Server install/update `install.lock` is authoritative for
  the Host package mirror worker. In addition, the installer writes a
  noncritical `dependency-busy` marker in the read-only package mount during
  deployment/dependency fetch. Already-authenticated HTTP package delivery
  checks that marker on each body read, pausing even in-flight byte-range
  transfers until the marker clears. Cancellation terminates the paused read;
  the next request can resume from a verified HTTP Range.
- Installer success, failure and rollback clear the marker. Host Control
  also clears an orphan marker after a hard crash **only** while holding a
  successful nonblocking probe of `install.lock`, avoiding premature resume
  during a real upgrade. A missing marker is nonfatal to Server upgrade.
- After dependency pulls finish, transfers resume at the normal, unrestricted
  rate. An interrupted connection may require the client to retry its HTTP
  Range; Server upgrades never wait for or depend on that client retry.
- The worker tries same-commit GitLab package bytes first, GitHub exact
  Bundle asset second, validates size and SHA-256, uses bounded retries, and
  never influences Server upgrade exit status or rollback decisions.
- Before mirroring bytes, the worker verifies the exact GitHub `bundle-<sha>`
  ref targets a **commit** with the requested full SHA and compares the
  manifest and every artifact against the immutable GitHub Release asset
  digest/size inventory. Missing, duplicated, altered, or mismatched assets
  fail closed without affecting Server health. This uses GitHub HTTPS
  provenance; it is **not** independent Sigstore verification.


## Authenticated distribution

- `GET /api/v1/release-bundles/current` returns cache state, complete
  commit, and exact package digests with fallback URLs. Entries list the
  local authenticated download first **only when a verified cache exists**,
  followed by GitLab and then GitHub. Clients MUST check SHA-256/size before
  installing from any origin; if a source fails, try the next. They MUST
  enforce their own signed-package and platform compatibility requirements.
- `GET|HEAD /api/v1/release-bundles/current/artifacts/:name` serves only
  current cache regular files after normal user authentication; byte-range
  downloads are supported. A missing package gives 404, not stale files.
- `POST /api/v1/admin/release-bundles/retry` requests an independent Host
  retry. A retry failure changes only Bundle status.

## Operations and compatibility

To inspect status, check `~/.xd/data/release-bundles/status.json` or the
authenticated API; Host errors are in `~/.xd/logs/release-bundle.log`.
Users should not confuse a Server upgrade success with an additional
package-cache success. No client must update merely because the Server
upgraded. Release Bundle publication needs its own exact-head CI/Final Gate
before it is considered shipped.

**Constraints:** This is not an automatic native app installer, IPA signing
service, or Android production signing system. Native updates must still use
their platform's own verified installation flow. The fallback addresses can
return 404 if that mirror has not published the same exact CI bytes; a hash
mismatch is a failed mirror, never authorization to install unverified bytes.
