# xDrive Linux AMD64 — five-package offline distribution

**Status:** Independent offline packaging, SHA-256 verification and a local-only
transactional installer. A published offline release must be produced by the
dedicated workflow from an **already successful GitHub master CI run**; adding
these scripts to the source tree does not itself publish or test a real bundle.

## Package boundaries

| Package | Files in archive | Required |
| --- | --- | --- |
| App | Exact CI Server image + Caddy/Web image + rendered hash-bound installer + pinned Compose/host scripts | Always |
| PostgreSQL | Exactly one postgres:17-alpine Linux AMD64 Docker image | Fresh installation, unless exact image is already cached |
| Media Worker | CI-built FFmpeg/FFprobe worker image | Only with media-worker profile |
| AI Runtime | Python/OpenCV/ONNX Runtime and analyzer code, without model weights | Only with Photo Intelligence |
| AI Models | Exact CI image's verified models, tokenizer and licenses | Only with Photo Intelligence |

Server, storage-init and worker use the **same Server image**. No extra Web
image is needed because Caddy contains Web. No user data, PostgreSQL database
files, Docker Engine, Docker Compose executable or OS packages are included.

A manifest pins the release commit, all five package SHA-256 hashes, **every
archive member**, and each imported Docker image ID. Tar archives are
normalized and named by content hash; byte-identical modules can be reused
without downloading them again. A *logical* module name is not sufficient
proof of interface compatibility: operators must retain validated module
versions when changing App versions. A changed Server/media socket or
Photo Intelligence API contract requires new compatible module builds.

## Build and publication

1. Wait for the relevant master CI run to finish **successfully**, including its
   exact-HEAD Final Gate and four required image artifacts.
2. From the GitHub **Actions** tab, run
   [Publish Five Offline Server Packages](../.github/workflows/offline-packages.yml)
   on master, supplying that completed **CI run ID**.
3. The workflow checks CI identity/ancestry, downloads the exact four image
   archives and rendered installer, pulls the PostgreSQL 17 Alpine image,
   extracts and SHA-verifies the exact CI-packaged models, and builds a separate
   model-free AI Runtime. It packages and verifies the five modules, then
   publishes an **immutable** offline-<source SHA 12> prerelease, with
   GitHub Actions/Sigstore provenance and manifest SHA-256 in release notes.

This expensive complete five-package export is **manual on purpose**;
high-frequency master pushes do **not** repeatedly export 775 MB of AI
assets. The ordinary GitHub/GitLab snapshot pipelines are unchanged.
A regular App-only release can be transported separately with the matching
published manifest when required components are already cached.

The workflow never modifies the existing rolling snapshot release (which has
its own strict asset allowlist). The output includes five xdrive component
archives, manifest.json, SHA256SUMS.txt, MANIFEST_SHA256.txt,
xdrive-offline.py, and publisher attestation bundle.

## Fully offline install

On a trusted online workstation, download the release assets and separately
authenticate the published manifest SHA-256 **from the official GitHub release
notes** and the GitHub Actions provenance. A hash written only on the same
untrusted USB drive does not authenticate an executable file. For extra
assurance, verify the release Sigstore bundle on the trusted workstation
before copying the packages.

Transfer the script, manifest and only the packages needed to the Linux
AMD64 Docker host (USB/LAN). **Do not** use a download-to-shell pipe.
Python 3, Bash, Docker Engine and Docker Compose v2 must already be installed.

~~~bash
# Exact 64-character digest copied from authenticated release notes.
TRUSTED_SHA256='replace-with-trusted-manifest-sha256'
python3 xdrive-offline.py list --dir ./packages
python3 xdrive-offline.py verify --dir ./packages \
  --components app,postgres --trusted-manifest-sha256 "$TRUSTED_SHA256"

# New basic server: App and PostgreSQL are enough.
python3 xdrive-offline.py install --dir ./packages \
  --components app,postgres \
  --trusted-manifest-sha256 "$TRUSTED_SHA256"

# A future App-only update may omit PostgreSQL if its exact image is cached.
python3 xdrive-offline.py install --dir ./packages \
  --components app \
  --trusted-manifest-sha256 "$TRUSTED_SHA256"

# Install all five components and enable both optional profiles:
python3 xdrive-offline.py install --dir ./packages \
  --components app,postgres,media-worker,ai-runtime,ai-models \
  --enable-media --enable-ai \
  --trusted-manifest-sha256 "$TRUSTED_SHA256"
~~~

Only components selected for import are required on disk. Verification checks
all archive members before modifying Docker images or deployment state.
Image loading is offline (Docker load); Photo Intelligence is assembled using
Docker build --network=none --pull=false from the verified runtime and models.
The trusted App installer stages verified local scripts, forbids Docker pulls
and retains existing xDrive backup/rollback and health-check behavior.

The offline installer does **not** download OS dependencies or issue public TLS
certificates. A brand-new public DNS-01 certificate requires DNS provider
connectivity; use an already issued certificate or postpone public HTTPS setup
until online. Local-IP HTTPS still needs appropriate local CA trust.

## Safety and limitations

- Missing/modified packages, unexpected tar members, symlinks, duplicate
  filenames, malformed manifests and mismatched Docker IDs **abort**.
- Install **requires** the independently authenticated manifest SHA-256.
  The publisher bundle is supplementary; a copied local checksum alone is not
  sufficient proof of a trusted publisher.
- The installer does not erase PostgreSQL/user data. Upgrades retain the
  existing transaction and rollback controls.
- PostgreSQL major upgrades are database migrations, not image swaps.
- Enabling optional profiles requires both supported module images locally.
  New AI Runtime requires the matching AI Models package for assembly.
- Offline packages for AMD64 cannot be used on ARM/DSM without separate builds.
- Existing online GitHub/GitLab updates retain their own source handling.
- Because optional worker and Photo APIs are not yet published as independently
  versioned ABI contracts, operators should keep the **compatible versions
  from a known validated release**; don't blindly mix unrelated versions.
- Until the first real end-to-end five-package build, Docker host install and
  no-network smoke test are completed, the result is **implementation in PR,
  not a production-validated offline distribution**.
