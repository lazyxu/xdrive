# Client installer mirror to an xDrive anonymous folder Share

## Included assets and observed size baseline

The separate **Mirror Client Installers To xDrive Share** GitHub Action collects only
existing, already-successful artifacts. The GitHub Snapshot publisher emits
`xdrive_snapshot_published` **after** it has verified and published its assets;
the mirror then runs automatically when enabled. A daily run retries publication
after delayed Android/iOS builds. It never builds or signs a client and never
delays or alters existing CI/Snapshot publication.

| Platform | Source | Example filename | Approx. bytes | Include |
| --- | --- | --- | ---: | --- |
| Windows x64 Desktop | Verified rolling `snapshot` release | `xDriveSetup-amd64.exe` | 150 MB | Yes |
| Linux x64 Desktop | Same verified snapshot | `xdrive-linux-amd64.deb` | 105 MB | Yes |
| DSM ARMv7 GUI | Same verified snapshot, **only if** XZ/GUI SPK verifier succeeds | `xdrivenas-armada38x-*.spk` | 8.7 MB | Conditional |
| Android | Latest successful **master push** Android Master APK workflow Artifact | `xdrive-android-master-*-debug.apk` | ~40 MB (ZIP Artifact total) | Yes |
| iOS | Latest successful **master push** iOS Native Unsigned IPA workflow Artifact | `xDrive-unsigned.ipa` | ~4 MB (ZIP Artifact total) | Yes |

The measured reference set totals approximately **308 MB**, plus SHA-256 sidecars.
Exact bytes and commits are reported by each workflow run (not hardcoded).
`Android` uses an ephemeral debug signer, so existing installs may not update
in-place. `iOS` requires SideStore/other user signing. Successful CI compilation
is not device installation validation.

Not mirrored: Docker/OCI image archives, Server, Caddy, photo/media-worker
images, backup CLI archives, diagnostics/scripts, Source Agent binaries, PR
artifacts or source tarballs. There is no macOS installer at present. Web/PWA
is served from the xDrive HTTPS website and has no offline installer to upload.

## Enable (explicit opt-in)

1. Create/use a **dedicated folder Share** with access **`view_upload`**, and
   no expiry that would interrupt unattended runs. Keep a public *read-only*
   download Share separate from the uploader capability if possible. The
   `view_upload` link grants anonymous upload to **every holder** of the link;
   do **not** enable guest uploads on a widely distributed read-only link.
2. Under repository **Settings → Secrets and variables → Actions**, create
   repository secret `XDRIVE_CLIENT_MIRROR_SHARE_URL` containing the **complete**
   `https://host:port/#/s/<token>` URL (the `#` route is parsed locally,
   never sent to Server). If password-protected, set optional secret
   `XDRIVE_CLIENT_MIRROR_SHARE_PASSWORD`. No Owner cookie, JWT or login needed.
   Never commit/share the capability or put it in workflow arguments or logs.
3. Run Actions → **Mirror Client Installers To xDrive Share** → Run workflow
   on `master`, with default `dry_run=true`. This verifies available source
   bytes and reports real sizes/commits **without uploading or using secrets**.
4. Once permitted and trusted, set repository variable
   `XDRIVE_CLIENT_MIRROR_ENABLED=true`. Each **successfully published master
   GitHub Snapshot** triggers an upload via the existing trusted
   `xdrive_snapshot_published` repository dispatch. The daily **04:37 UTC**
   schedule retries any late/failed mirror attempt; no new client build is
   started. `workflow_dispatch` with `dry_run=false` runs on demand even
   if the repository variable is not yet enabled (but requires secrets).
5. Confirm the new Share directory `xDrive-Clients/`, with per-platform,
   12-character-commit subfolders and `<filename>.sha256` companion files.

A Share **must be a directory**, must be reachable from GitHub-hosted Ubuntu
runners on HTTPS with a publicly trusted certificate/hostname, and must
advertise upload capability. A read-only/expired/password-mismatch/share-file
link **fails closed**. We do not disable certificate verification, follow
redirects carrying capabilities, fall back to an Owner login, or upload a
sample file to an unverified destination.

## Versioning, idempotency, integrity

Every file is immutable and stored at:

```
xDrive-Clients/windows/<source-sha12>/xDriveSetup-amd64.exe
xDrive-Clients/linux/<source-sha12>/xdrive-linux-amd64.deb
xDrive-Clients/dsm/<source-sha12>/xdrivenas-armada38x-<version>.spk
xDrive-Clients/android/<source-sha12>/xdrive-android-master-<sha12>-debug.apk
xDrive-Clients/ios/<source-sha12>/xDrive-unsigned.ipa
```

The real xDrive anonymous API uses `conflict_policy=keep_both`, **not** replace;
therefore the mirror checks the shared folder before writing. A same-name,
same-size file is skipped; a same-name **different-size** conflict fails rather
than silently producing `(1)` copies. A deterministic HMAC-based resume key
permits retry/recovery of the same chunked upload session. Each successful
binary receives a `.sha256` sidecar. The mirror never deletes existing files,
rewrites a `latest` pointer or sends a full folder ZIP. To limit disk usage,
remove old version subfolders through an authenticated Owner UI when desired.

For content origin, always prefer exact GitHub Release SHA-256/CI provenance:
files in an anonymously writable Share are **not tamper-proof** even with
SHA-256 companions, because any holder of that Share can inject other files.
The workflow requires complete source SHA, nonexpired artifacts, independent
source hashes and exact successful master-run identities. If the rolling
Snapshot tag changes mid-download, collection aborts rather than producing an
inconsistent labeled version. A DSM SPK failing the published GUI/XZ validator
is **excluded**, not advertised as installable.

## Failures and resource policy

- Each upload uses the existing Share session API (`directories`, `uploads`,
  `chunks`, `finalize`), 8 MiB SHA-256 chunks, at most one file at a time and
  bounded retry/backoff for transient 408/429/5xx and timeouts. All requests
  are Share-scoped and repeat the capability/password. TLS verification and
  no cross-host redirects are mandatory.
- The source plan excludes files over 256 MiB and any unsupported archive;
  the local source is hashed again just before upload, and all files are
  validated **before the first remote write**.
- Automatic post-publication upload and the daily recovery schedule do not
  run unless the owner explicitly sets `XDRIVE_CLIENT_MIRROR_ENABLED=true`.
  Both require `XDRIVE_CLIENT_MIRROR_SHARE_URL` as a separate Actions secret;
  the job checks that it exists before downloading large artifacts. Manual
  `dry_run=true` never needs the secret. PR tests run offline, never receive
  the credential and cannot upload. Publisher dispatch, scheduler and manual
  runs use a single non-canceling concurrency group.
- CI/GitHub/Share hosting, WAN route, server storage and actual uploaded-byte
  acceptance are outside repository-only validation until a secret is
  configured and a real workflow has successfully completed. Physical device
  installation is **跳过（未验收）**.

## Scope boundary: client mirror is not a Server update provider

This folder contains **client installers only**, not Docker images, deployment
scripts or a full compatible Server release bundle. It **must not** be passed to
`xdrive-server update` as if it were GitHub or GitLab. An upload Share is also
an untrusted distribution source: a colocated `.sha256` file can be forged
alongside its binary. A future `--source xdrive` updater requires an
authenticated/signature-verified, rollback-protected component manifest bound
to exact image digests and a read-only download capability. The current
five-component offline Manifest is tracked in PR #3625; until its manifest
and the Share reader have passed separate CI/restore acceptance, keep the
existing `--source github|gitlab` Server updater unchanged. The public
download link should remain read-only, with a separate **private** uploader
capability to the same Owner-controlled storage directory.
