# Authenticated deployment asset bytes

The signed GitHub Release installer (`xdrive-server-install.sh`) is trusted by
the installed host updater's checksum/Sigstore checks. It then downloads
additional deployment assets from the `SOURCE_REF` commit on raw GitHub.
A fixed commit ref alone does not verify the HTTP response bytes.

The common master/stable Release workflow now creates an SHA-256 manifest
covering all 11 Stage 3 raw deployment files. It embeds the base64-encoded
manifest directly into the rendered Release installer **before** calculating
its SHA-256 and issuing its Sigstore provenance. The manifest is therefore
inside the authenticated installer; no new external manifest endpoint is
required.

After downloads, Stage 3 checks every expected digest, rejects malformed,
duplicate, absent, unexpected or mismatching entries, and aborts before any
backup, host-manager replacement, service restart, or installation of the
downloaded scripts.

The legacy unrendered raw `deploy/install-server.sh` bootstrap entry retains
its existing distribution semantics, explicitly logging that no embedded
deployment hashes were available. This does **not** authenticate the first
installation. GitLab raw bootstrap remains outside GitHub-only release
provenance; separate provider-specific signing would be required for parity.

Tests cover a rendered success, a corrupted downloaded script, incomplete
manifest, malformed base64, and the static asset inventory contract.
Production-only inaccessible acceptance: **按用户决定跳过（未验收）**.
