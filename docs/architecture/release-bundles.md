# xDrive Commit-based Release Bundle (v1)

This protocol is **additive**. A Server release is never blocked by an
independently scheduled client-package cache and a client is **never forced**
to match the Server commit. Server update, backup, rollback and compatibility
checks remain authoritative.

## Identity and immutable publication

**Platform immutability is separate from source-level no-clobber guards.**
The first observed public `bundle-2f5787bef3e1c825f00ff912e8bcd820d6862326`
Release has `immutable: false`, despite its exact source ref and Release
asset digest inventory. It must not be represented as a GitHub-locked Release.
GitHub repository **Settings → Releases → Enable release immutability** must
be enabled by an authorized repository administrator; this applies to
future Releases, not retroactively to that already published one.
The independent parent CI `verify-published-bundle` job now requires
`immutable: true` *and* the signed Manifest proof for subsequent Releases.
It is intentionally not a dependency of the core Server/Snapshot publish job.


- A Bundle is identified by the **complete lowercase 40-hex Git Commit**,
  not by a rolling `snapshot`, 12-character prefix, build number or
  platform version string.
- An immutable GitHub Release `bundle-<full-sha>` publishes
  `release-bundle.json` and the exact same-commit client packages. Its
  publisher verifies the tag ref, every asset name and SHA-256 on retries.
  CI also produces a Sigstore attestation for the manifest. A **separate
  top-level post-publish CI job** verifies the actual published Release and
  independent Sigstore proof, without becoming a dependency or nested failure
  of the Server's reusable release workflow. Real verification cannot pass
  merely from publisher mocks.
- Artifact records include `platform`, `filename`, `build_commit`,
  `sha256`, `size`, `install_mode` and ordered preferred origins.
  **Missing platforms are omitted**. Android Debug APKs are never mirrored. Only independently approved,
  fixed-key signed public Android APKs may be included. The `xDrive-unsigned.ipa`
  is explicitly `manual_test_only`: it can be downloaded for developer signing,
  but MUST NOT be offered as a direct or automatic iOS installer.
  **Windows master Snapshots built without the configured production signing
  certificate are `manual_test_only`**, never eligible for ordinary channel
  auto-update. For a single-owner personal Desktop, the ordinary **客户端更新**
  page may offer a *separately confirmed* private unsigned Snapshot install
  for the exact current authenticated Server Commit. The user must acknowledge
  the absence of Authenticode; this does not add publisher identity assurance.
  The native path checks that it is Windows AMD64 + master channel, the fixed
  `xDriveSetup-amd64.exe` filename, full Git Commit and public GitHub Bundle
  tag/asset inventory, and exact size/SHA-256 before installer execution.
  Windows PowerShell rechecks size/SHA-256 after Agent exit and confirms that
  the package is actually unsigned. Wrong Commit, wrong platform, signed/invalid
  package in unsigned mode, or an unconfirmed request fail closed. Other
  signed releases retain the original Authenticode publisher checks.
  The exact-run Windows package job verifies Authenticode when configured
  signing is present; the publisher may use `--windows-signed` only for
  that signed CI path. Stable Windows assets remain signed-only.
- Existing Linux/Windows/Backup CLI/DSM publish contracts remain in place;
  separately published iOS and signed Android outputs may enter a Bundle only when the
  exact-source Release is already present and verified at Bundle publication.
  A later native build does not mutate an existing immutable manifest.
- The existing GitHub/GitLab `snapshot` and stable channel releases are
  unchanged, so old clients retain compatibility.

## Ordinary Desktop current-Server update and install acceptance

The Desktop **客户端更新** page offers the same current-Commit Bundle card
to authenticated non-admin users, but no admin-only Host cache retry action.
The separate administrator **管理 → 系统更新** page retains cache diagnostics
and retry. Both views are opt-in: updating Server never pushes a client install.

Exact-Commit native install is supported for Windows and Debian-family Linux
AMD64 when an applicable artifact actually exists. `xd version --json` and
`xdrive-agent --build-info-json` expose embedded build provenance; the
electron-builder package includes `resources/xdrive-build-info.json` from
the same source Commit. Windows checks installed xd, authenticated Agent hello
and the launched Electron Desktop lifecycle event against the target SHA
before committing its last-known-good transaction. Linux checks installed
xd, Agent and Desktop build metadata following authorized apt/PolicyKit
installation. A textual version such as `snapshot` alone is insufficient.

Before any native Windows/Linux installer is executed, the independent public
GitHub trust check must verify the exact Bundle tag commit, Release
`immutable:true`, and the published installer size and SHA-256. It also
retrieves the raw `release-bundle.json` from GitHub's numeric Release asset
endpoint, permitting only GitHub-owned release asset CDN redirects; the asset
bytes must match the GitHub Release's manifest digest and size. The parsed
manifest must identify the same full Commit and exact requested platform,
filename, mode, source URLs, size and SHA-256. **Every other manifest entry**
must correspond one-to-one with the published Release asset inventory. A
missing/unreadable/tampered manifest fails closed; an authenticated Server
cannot introduce an installer not actually present in the immutable public
manifest. This independent pre-install check is distinct from the Host's own
caching and the operator's real deployment acceptance.

This source implementation is not a claim of real-device acceptance. Confirm
the actual Windows personal unsigned installer (including its OS warning),
rollback after a deliberately failed post-install SHA check, restart and Agent
health. Confirm Linux `pkexec` admission, file/Commit validation, failure
recovery and UI restart on a real authorized desktop. CI mock and packaging
checks must be recorded separately from physical-device results.

## Noncritical Host worker

- The installed `release_bundle.py` worker starts after the Server's
  successful upgrade/health check/transaction commit. It also runs from the
  independent Host Control runner and is retryable by the admin.
- Host cache: `~/.xd/data/release-bundles/` by default. This is mounted
  read-only in the Server container at `/release-bundles`. The Host owns all
  writes. No Docker socket or privileged Host paths are served over HTTP.
- `manifests/<full-sha>.json`: immutable historical audit/provenance records
  only; there is **no historical version selector**. `current.json` points
  to the verified installer subset of the current Server Git Commit.
  `packages/<current-sha>/` contains only validated package bytes.
  When some package downloads fail, other verified packages are usable.
  Until any new package is verified the previous cache may remain on disk,
  but is never offered as the current Commit. `status.json` is completely
  separate from Server update/rollback status.
- During Server image/dependency transfers, the Host installer writes
  `dependency-busy` and keeps `install.lock`. Both Host cache mirroring
  and authenticated in-flight HTTP package bytes pause. After the final
  Server dependency pull succeeds, the installer publishes the Host-only
  `dependency-ready` marker and removes `dependency-busy`, so package
  transfers resume **immediately without a speed cap**, even while the
  remaining health/update transaction owns `install.lock`.
- Before `dependency-ready` is created, `install.lock` fails closed if
  the busy marker is absent. Busy always outranks ready. Both markers are
  cleaned on exit/rollback; Host Control removes stale markers only after a
  successful nonblocking install-lock probe. Marker errors are warnings,
  never Server update failures. Paused HTTP range downloads remain
  cancellation-aware and can retry with Range.
- The worker tries same-commit GitLab package bytes first, GitHub exact
  Bundle asset second, verifies size and SHA-256 and uses bounded retries.
  Each verified installer may be exposed independently for the current Commit,
  while failed ones retain resumable partial data. Per-item states include
  `verified`, `pending`, `missing_upstream`, `verification_failed` and
  `retry_needed`. Every failure is noncritical and never influences Server
  upgrade exit status or rollback decisions.
- Before mirroring bytes, the worker verifies the exact GitHub `bundle-<sha>`
  ref targets a **commit** with the requested full SHA and compares the
  manifest and every artifact against the immutable GitHub Release asset
  digest/size inventory. Missing, duplicated, altered, or mismatched assets
  fail closed without affecting Server health. This uses GitHub HTTPS
  provenance by default. To independently verify the signed Manifest before
  **every Host cache promotion**, install a trusted GitHub CLI on the Host and
  set `XD_RELEASE_BUNDLE_VERIFY_SIGSTORE=required` in its Host `.env`.
  The Worker then pins the OIDC signer workflow, full source Commit, master
  source ref (when applicable), and immutable GitHub repository ID 1382670236.
  Missing tools or invalid attestations fail only the optional client cache,
  never the Server upgrade. Without this setting Host Sigstore enforcement is
  explicitly **not active**.


## Authenticated distribution

- `GET /api/v1/release-bundles/current` returns only the current Server
  Commit, its per-package cache state and exact digests with fallback URLs.
  No historical Bundle selection endpoint or version selector exists. Entries list the
  local authenticated download first **only when a verified cache exists**,
  followed by GitLab and then GitHub. The native Desktop updater only opts
  into this alternate source when the independently selected release channel
  already pins the **same full Commit, filename, platform and SHA-256**; a
  missing or conflicting channel digest falls back to the original channel
  download rather than accepting a Server-created trust root.
  No authenticated local redirect is followed, and Owner credentials never
  leave the pinned Server origin. All downloaded bytes are SHA-256/size checked
  before being made available as an installer. The Windows detached updater
  also rechecks bytes and its installed Authenticode publisher identity before
  execution, including after the Agent has exited. Other clients MUST enforce
  their own signed-package and platform compatibility requirements.
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

The bundled `cli` artifacts are currently **Backup-only CLI** archives; a separate
standalone `xd`/Agent installation is not represented until its independent
source-exact package build exists. Do not advertise these as all CLI variants.

## Read-only live release and Host acceptance gate

After a *real* `bundle-<40-hex>` GitHub Release exists, run:

```bash
python3 scripts/ci/verify-live-release-bundle.py --commit FULL_SERVER_SHA
```

For a **real installed Host** (the command checks actual cached bytes and the
running authenticated Server API, not a mock):

```bash
XD_BUNDLE_OWNER_TOKEN='...' python3 scripts/ci/verify-live-release-bundle.py \
  --commit FULL_SERVER_SHA --host-home "$HOME/.xd" \
  --server-url https://your-server.example --require-sigstore
```

`--require-sigstore` needs an independently installed and trusted GitHub CLI
(`gh attestation verify`), validates the signed manifest digest, full source
Commit, signer workflow and GitHub repository ID 1382670236, and **fails
closed** if unavailable. No Owner credentials are sent to GitHub. It is an
explicit acceptance gate, not proof that every installed Host has the CLI.

For a real authenticated download and resume SHA-256 check add
`--check-server-download` (requires `--server-url` and Owner token). This
performs two actual HTTP `Range` transfers per cached artifact, recombines the
bytes in order and compares the full hash. It never installs a package.

Host acceptance treats the documented `retry_needed` **partial verified cache**
as usable when at least one package passed full disk SHA-256; unavailable
platforms do not block the Server or verified packages. Use
`--require-complete-cache` only when an operator explicitly requires every
platform to be cached. A zero-verified partial cache still fails.

For an intentional, expensive end-to-end mirror-byte audit add
`--check-package-bytes`. This verifies actual package bytes from both GitLab
and GitHub; inaccessible GitLab or a missing optional upstream fails that
**optional strict mirror check**, not an existing Server upgrade. Use the
authenticated API check only over HTTPS (or `--allow-loopback-http` for local
loopback testing). The gate never installs software or asserts physical-device
success. Actual Windows transaction, Linux PolicyKit authorization, DSM package
install, Apple signing and Android production signing still need device-specific
acceptance evidence. Missing client platforms remain allowed.

**Constraints:** This is not an automatic native app installer, IPA signing
service, or Android production signing system. Native updates must still use
their platform's own verified installation flow. The fallback addresses can
return 404 if that mirror has not published the same exact CI bytes; a hash
mismatch is a failed mirror, never authorization to install unverified bytes.
