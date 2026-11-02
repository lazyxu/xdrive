# Server updates from an xDrive Share

Linux AMD64 Server can use a read-only folder Share as its master update source:

```sh
xdrive-server update --source xdrive --channel master
```

This provider uses the [five-component offline installer](server-five-package-offline.md).
GitHub remains the publisher identity. The Share carries the exact published
bytes; the local verifier authenticates them independently. Stable and other
architectures are rejected. Existing GitHub/GitLab sources remain available.
Client installation and their source selectors are separate from this Server command.

## Publication and quick transfer

The offline publisher produces immutable component releases, then an attested
`delivery.json` binding the complete Manifest and installer to the master commit
and first-parent generation. Only published, verified GitHub releases are
mirrored. Interrupted drafts resume by verifying existing assets and adding
missing assets; conflicting bytes are never overwritten.

Enable the same repository secret `XDRIVE_CLIENT_MIRROR_SHARE_URL`, optional
`XDRIVE_CLIENT_MIRROR_SHARE_PASSWORD`, and variable
`XDRIVE_CLIENT_MIRROR_ENABLED=true` described in the
[client mirror setup](client-artifact-share-mirror.md). Use a private
`view_upload` capability and a separate read-only consumer capability for the
same folder. No Owner login or upload token is installed on consuming hosts.

The directory layout is:

```text
xDrive-Server/packages/<full-package-sha256>/<filename>
xDrive-Server/master/<generation>-<full-commit>/manifest.json
xDrive-Server/master/<generation>-<full-commit>/xdrive-offline.py
xDrive-Server/master/<generation>-<full-commit>/delivery-attestation.jsonl
xDrive-Server/master/<generation>-<full-commit>/delivery.json
```

`delivery.json` is uploaded last. Existing files are checked by size and SHA-256.
New paths initialize an ordinary Share upload with SHA-256 and size: a Server
that already has a current matching file visible under this Share returns a
finalized receipt without receiving data chunks. Other files use the same
bounded chunk/resume protocol. This preserves Share and Owner isolation.

If a mirror failure makes the source CI run fail, rerun its failed jobs. A new
manual dispatch still requires a successful source CI run; it does not bypass
the publication prerequisites.

## Trusted initial configuration

Install the accepted host manager and its `xdrive-share-update.py` deployment
asset using a trusted existing deployment channel. Python 3 is required.
Provision a GitHub CLI verifier and Sigstore trusted root independently of the
Share, verify their provenance, and pin both local file hashes. The provider
performs local bundle verification; it needs no GitHub credential or network
access for signature verification.

Create `$XDRIVE_HOME/config/xdrive-share-update.json` (default home `~/.xd`),
owned by the service user with mode `0600`. All paths must be absolute regular
files without symlink/reparse ancestors:

```json
{
  "schema": 1,
  "share_url": "https://your-server/#/s/<read-only-capability>",
  "verifier_path": "/home/user/.xd/bin/xdrive-attestation-gh",
  "verifier_sha256": "<independently-verified-sha256>",
  "trust_root_path": "/home/user/.xd/config/xdrive-sigstore-trusted-root.jsonl",
  "trust_root_sha256": "<independently-verified-sha256>",
  "initial_sequence": 123
}
```

Use a trusted master first-parent generation as the initial rollback floor,
for example `git rev-list --first-parent --count <trusted-installed-commit>`
in a complete canonical history. The number above is only an example.
The first selected release must be newer than that floor. To allow an exact
initial release, additionally provision both `initial_source_commit` and
`initial_descriptor_sha256` from a trusted channel. An optional
`share_password` stays in this same private configuration.

Verification pins repository ID `1382670236`, `lazyxu/xdrive`, the
`offline-packages.yml` signer workflow, `refs/heads/master` and hosted runners.
Metadata, HTTPS origin, ticket routes, paths, sizes and SHA-256 values are
checked before any downloaded installer executes. A corrupt completed newest
release fails rather than selecting an older release silently.

## Staging, activation and recovery

```sh
xdrive-server update --source xdrive --channel master --prefetch-only
xdrive-server update --source xdrive --channel master
```

Prefetch downloads and verifies all five components without running the
installer. The persistent cache reuses unchanged verified package bytes.
The regular update stages and verifies everything before entering the existing
offline backup/activation/health-check transaction. Docker image imports finish
before maintenance; the installer forbids network pulls. Thus the Share may
be hosted by the same Server being updated.

An installation preserves enabled optional modules, writes `xdrive` as the
transport preference only inside the backed-up transaction, and retains
`github` as artifact provenance. `--backup-file-data` forwards the existing
file-data backup option. The installer restores the previous configuration
and image references on health failure. An atomic high-water record prevents
older or conflicting deliveries; retries of the same verified delivery remain
allowed. Do not clear that record to work around a verification failure.

Passing repository tests is not evidence of a published release or a host
upgrade. Deployment evidence must record the actual published commit,
successful signature verification, target version and health separately.
