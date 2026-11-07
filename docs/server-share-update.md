# Historical Server updates from an xDrive Share

**Publisher retired (2026-11-07).** New master/offline releases are now
published only through verified GitHub Releases. The old automated and manual
Share mirror publishers have been deleted, not merely disabled with an opt-in
variable. Existing cloud files are left unchanged.

Linux AMD64 Server can still consume **previously mirrored, signed** releases
from a read-only folder Share, subject to existing trust and rollback checks:

```sh
xdrive-server update --source xdrive --channel master
```

This provider uses the [five-component offline installer](server-five-package-offline.md).
GitHub remains the publisher identity. The Share carries the exact published
bytes; the local verifier authenticates them independently. Stable and other
architectures are rejected. Existing GitHub/GitLab sources remain available.
Client installation and their source selectors are separate from this Server command.

## Historical immutable layout (read-only)

Old releases remain under `xDrive-Server/packages/` and
`xDrive-Server/master/` with signed component manifests and an authenticated
`delivery.json` completion marker. They are **not** deleted or rewritten by
retiring the uploader.

The Share updater cannot discover new GitHub Releases through this historical
directory. Use `xdrive-server update --source github --channel master` (or
the existing GitLab source) for new updates. Do not enable anonymous upload
or recreate the retired Share mirror to work around a stale source.

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

If the Share is hosted on the updating Server and its public DNS address is
unreachable from that host, optionally set `"connect_address": "127.0.0.1"`
in this trusted configuration. It must be a literal IPv4 or IPv6 address (no
hostname, port or IPv6 zone). This changes only this Share client's socket
destination, retaining the original HTTPS URL, port, Host, SNI and default CA
and hostname verification. The selected address must serve that HTTPS identity.
An explicit pin bypasses ambient proxies for this Share client; redirects remain
forbidden. Omitting the field preserves normal DNS and proxy behavior. It does
not change system hosts, proxy settings or other update providers.

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
