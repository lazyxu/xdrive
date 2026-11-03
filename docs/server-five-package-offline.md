# xDrive Linux AMD64 — content-addressed offline release design

## Published components and frequency

Five independently downloadable modules share a complete, immutable Manifest:

| Package | Contents | Rebuild trigger |
| --- | --- | --- |
| App | Exact CI Server + Caddy/Web images and pinned host installer/assets | Relevant Go/Web/Caddy/host inputs |
| PostgreSQL | Linux AMD64 PostgreSQL 17 Alpine | Actual Docker image ID change |
| Media Worker | Exact CI FFmpeg/FFprobe image | Worker/shared Go code or ABI change |
| AI Runtime | Python/OpenCV/ONNX analyzer without models | Python code, dependencies or ABI change |
| AI Models | Models, tokenizers and license files from verified CI image | Pinned model SHA-256/ABI change |

Server, storage-init and background worker reuse ONE Server image; Caddy
already contains the Web files. User data, database files and Docker Engine
are NOT in the offline package.

After the normal fast Snapshot publisher, every successful master CI Final
Gate calls the offline publisher. The publisher computes a conservative source
fingerprint for each component plus the current PostgreSQL Docker image ID.
Unchanged packages retain their **existing immutable release tags and exact
SHA-256 bytes**. Only changed packages are downloaded from CI, compressed,
attested and published.

The full Manifest is published for EVERY verified master Commit as an
immutable offline-manifest-<SHA12> GitHub Release. Its five package descriptors
each have release_tag, filename, content hash, original build Commit,
per-file checksum and exact image identity. Component releases are tagged
offline-<component>-<archive SHA12>. No mutable offline-current tag is used,
and the rolling GitHub Snapshot asset allowlist is unchanged.

Normal master CI **still builds and tests its required images**. Selective
distribution does not remove those correctness gates. The first valid offline
publication seeds all five modules; subsequent publications may upload zero
or only a few modified archives. Operators may also manually dispatch the
offline workflow with an exact successful master CI run ID; every path
requires its exact Final Gate.

## Compatibility and rollback

- Tracked protocol contracts are stored in scripts/offline/contracts.json
  (PostgreSQL major version, Media Worker API, Photo Intelligence API and
  model/runtime API). Changing a contract invalidates dependent fingerprints
  rather than silently mixing old incompatible components.
- Media Worker is conservatively invalidated by shared Go changes because
  its current build compiles the Server Go tree. Changing FFmpeg alone is
  not the only reason to republish this component.
- PostgreSQL gets an immutable content-derived Docker image tag, not merely
  postgres:17-alpine, so prior rollback images remain available.
- PostgreSQL major upgrades require a separate data migration plan.
- The existing installer still applies pre-upgrade backup, rollback and
  health gates. A checksum alone never proves protocol compatibility.
- After a successful offline activation, the host records its installed
  component fingerprints, declared contract versions and active module image
  references in private state. App-only upgrades with an enabled optional
  module fail closed when the previous contract or image identity is unknown.
- New App/API combinations still require real integrated validation of
  optional Worker/AI protocols before claiming compatibility.

## Verify and install with no internet access

On a trusted online workstation, verify the official GitHub Actions
publisher attestation and copy **both trusted SHA-256 values** (Manifest
and standalone installer tool) from the authenticated Manifest Release.
A checksum on the same untrusted USB drive is not a trusted source.

Download the Manifest, standalone installer tool and only the needed
component packages. Each package is available from the immutable URL:

    https://github.com/lazyxu/xdrive/releases/download/<release_tag>/<filename>

A GitLab mirror can transfer identical signed bytes; its URL is not a
replacement for the independent trust root.

Python 3, bash, Docker Engine and Compose v2 must be installed on the
Linux AMD64 host before going offline. No user files, PostgreSQL data,
Docker Engine or DNS-01 certificate issuance are bundled.

~~~bash
# Compare this installer SHA-256 to authenticated release notes FIRST.
sha256sum xdrive-offline.py
TRUSTED_MANIFEST_SHA256='64-character-sha256-from-authenticated-release'

python3 xdrive-offline.py list --dir ./packages
python3 xdrive-offline.py verify --dir ./packages \
  --components app,postgres \
  --trusted-manifest-sha256 "$TRUSTED_MANIFEST_SHA256"
python3 xdrive-offline.py install --dir ./packages \
  --components app,postgres \
  --trusted-manifest-sha256 "$TRUSTED_MANIFEST_SHA256"

# App-only incremental update when all dependencies are present and compatible:
python3 xdrive-offline.py install --dir ./packages \
  --components app \
  --trusted-manifest-sha256 "$TRUSTED_MANIFEST_SHA256"
~~~

An App-only update need not download the AI Models or PostgreSQL again if
the exact cached dependencies remain compatible. The current installer does
not yet persist an independent model-cache archive; switching only the AI
Runtime or only AI Models while the complementary package is absent still
requires supplying both model and runtime bytes to assemble the photo
container. Do not claim this corner case solved before a real test.

Offline mode refuses unverified bytes and forbids new Docker image pulls.
For a first-time public domain, DNS-01 certificate issuance still requires
access to the DNS provider. Immutable offline manifests and component packages are now published through
the offline GitHub Actions workflow. Publication and release hashes do not
establish that a particular host has successfully upgraded; physical activation
and rollback acceptance remain separate.

## Fixed-identity Host import (UI and CLI share the same executor)

Server administrators may stage the existing five-component Manifest release in
`~/.xd/state/update-imports/<32-lowercase-hex-import-id>/`. The directory
contains `manifest.json`, `xdrive-offline.py` and only the needed immutable
component archives, plus optionally `delivery.json` and
`delivery-attestation.jsonl`. The Host never resolves a free-form path from an
admin request.

```bash
xdrive-server update --source offline --channel master \
  --offline-id 0123456789abcdef0123456789abcdef \
  --trusted-manifest-sha256 "$TRUSTED_MANIFEST_SHA256" \
  --trusted-installer-sha256 "$TRUSTED_INSTALLER_SHA256"
```

The two SHA-256 values must come from an independent authenticated channel,
not from checksums on the same untrusted drive. If the trusted Share verifier
and Sigstore root are configured and signed delivery metadata is provided, the
Host verifies release, manifest and installer publisher signatures and derives
both hashes instead; an invalid signed delivery cannot fall back to manual
hashes. Both paths then invoke the same authenticated `xdrive-offline.py
verify/install` and existing xDrive transactional installer used by the Share
provider. Files are reverified before import; no Docker or network pull occurs
during a rejected preflight. This command does not install a Desktop APK/IPA
or use DSM SPK update semantics.

The pending browser/Host-controlled directory import UI uses this same CLI
Host authority rather than embedding a second installation engine.
