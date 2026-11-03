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
| Backup CLI Linux/Windows | Verified rolling Snapshot | `xdrive-backup-linux-amd64.tar.gz`, `xdrive-backup-windows-amd64.zip` | ~8 MB each | Yes |
| Source Agent Linux amd64/arm64 | Verified rolling Snapshot | `xdrive-source-agent-linux-*` | ~8 MB each | Yes |

Exact bytes, sizes, source commit and names are reported by each workflow run.
Backup CLI archives and Source Agent executables are included in their own
product-category directories; they are not Desktop installers.
`Android` uses an ephemeral debug signer, so existing installs may not update
in-place. `iOS` requires SideStore/other user signing. Successful CI compilation
is not device installation validation.

This workflow does not mirror Docker/OCI image archives, Server, Caddy,
photo/media-worker images, deployment scripts, PR artifacts or source tarballs.
There is no macOS installer at present. Web/PWA is served from the xDrive HTTPS
website and has no offline installer to upload.
Server packages use the separate [signed Share update publisher](server-share-update.md).

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
5. Confirm product directories `Desktop/`, `Mobile/`, `DSM/`, `Backup-CLI/`
   and `Source-Agent/` under the **shared root folder**, each containing flat,
   versioned files with `<archived-filename>.sha256` companions.

A Share **must be a directory**, must be reachable from GitHub-hosted Ubuntu
runners on HTTPS with a publicly trusted certificate/hostname, and must
advertise upload capability. A read-only/expired/password-mismatch/share-file
link **fails closed**. We do not disable certificate verification, follow
redirects carrying capabilities, fall back to an Owner login, or upload a
sample file to an unverified destination.

## Versioning, idempotency, integrity

The folder Share itself is the user's `/xDrive Release` directory. **Plan B**
stores every new release as an immutable file directly under its product group
(illustrative UTC and SHA only):

```text
/xDrive Release/
├─ Desktop/
│  ├─ xDriveSetup-master-20261103T123456Z-8ed415f083f6-win-amd64.exe
│  └─ xDriveDesktop-master-20261103T123456Z-8ed415f083f6-linux-amd64.deb
├─ Mobile/
│  ├─ xDrive-master-20261103T123456Z-8ed415f083f6-android-debug.apk
│  └─ xDrive-master-20261103T123456Z-8ed415f083f6-ios-unsigned.ipa
├─ DSM/
│  └─ xdrivenas-master-20261103T123456Z-8ed415f083f6-dsm-armada38x-0.1.0-7642.spk
├─ Backup-CLI/
│  ├─ xdrive-backup-master-20261103T123456Z-8ed415f083f6-linux-amd64.tar.gz
│  └─ xdrive-backup-master-20261103T123456Z-8ed415f083f6-win-amd64.zip
├─ Source-Agent/
│  ├─ xdrive-source-agent-master-20261103T123456Z-8ed415f083f6-linux-amd64
│  └─ xdrive-source-agent-master-20261103T123456Z-8ed415f083f6-linux-arm64
├─ xDrive-Clients/            # prior historical layout, retained as-is
└─ xDrive-Server/             # signed five-component publisher, unchanged
   ├─ packages/
   └─ master/
```

The timestamp is derived from the **actual source Git commit's UTC committer
time**, not the local uploader clock or the rolling Snapshot asset upload
timestamp. It therefore remains identical on retries and recovery. Each platform
may use a different original commit; the full 40-character source commit and
SHA-256 are retained in the verified job Manifest. Renaming changes only the
Share-visible archive filename, not the signed installer bytes.

Existing historical `xDrive-Clients/platform/commit12/` files are **not
migrated, renamed, deleted or overwritten**. Re-uploading their verified
content into the new flat paths can reuse the existing Share-visible CAS blob
through the normal instant upload receipt; a cache miss follows ordinary bounded
chunk upload. The server's `xDrive-Server/packages` and `master` paths remain
unchanged because the signed Server updater depends on them. No `latest`
directory, mutable alias or automatic cleanup is part of Plan B.

The real xDrive anonymous API uses `conflict_policy=keep_both`, **not** replace;
therefore the mirror checks the shared folder before writing. A same-name,
same-size file is skipped only after its bytes pass SHA-256 verification through
a scoped download ticket. A size or digest conflict fails rather than silently
producing `(1)` copies. A deterministic HMAC-based resume key
permits retry/recovery of the same chunked upload session. Each successful
binary receives a `.sha256` sidecar named after its **archived** filename.
The mirror never deletes existing files, rewrites a `latest` pointer or sends
a full folder ZIP. To limit disk usage, retire old individual archive files
only through authenticated Owner UI, never the anonymous upload capability.

Every upload initialization includes the full SHA-256 and size. When the Server
can reuse a current file visible inside this same Share subtree, it returns a
durable finalized receipt and the uploader sends **zero data chunks**. Files
outside the Share, historical/deleted files and another Owner's files are not
eligible. Older Servers continue through the existing chunk upload protocol.

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

The flat product directories contain **client installers, Backup CLI and Source
Agent artifacts only**, not Docker images, deployment scripts or a full Server
release bundle. It **must not** be passed to
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
