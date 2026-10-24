# Caddy Applied Collector — P0-03 operator-pinned Ed25519 key preflight

Status: **source-only key preflight**, not a running Collector, signer, publication mechanism or current Applied status. This change must not be used to mark Issue #2075 complete.

## Trust boundary

The future Caddy Collector is a dedicated non-root Linux process with a UID different from the Server UID. The operator, out of band, pins the SHA-256 of the **DER-encoded Ed25519 SubjectPublicKeyInfo**. Neither browser, Server, Agent, PostgreSQL Desired, Caddy Host .env nor a caller-supplied operation may select the pin or key directory.

The private-only function `privatePreflightOperatorCollectorKey` reads the fixed file `collector-ed25519.v1.pk8` in an operator-owned **0700** directory. Its path comes only from future trusted local Collector service configuration, not from a new HTTP or IPC handler. It validates:

- Absolute canonical directory path with no symlinks, non-root/current-UID ownership, exact 0700 mode, stable opened directory identity. The directory is opened by a root-to-leaf **directory-relative `openat` walk with `O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK` on every component**, not `os.Open` after an earlier `Lstat`; switched final or ancestor symlinks fail closed. Reject setuid/setgid/sticky bits on both the directory and key, even if low permission bits are otherwise acceptable.
- Server UID differs from current Collector UID; deployment using the same or root UID returns **unverified**.
- Fixed single-linked regular key file, exact 0600 mode, matching owner, no-follow **nonblocking** `openat` beneath the already-opened directory, size bounds, stable inode, mode, mtime and ctime before/after reading. A FIFO raced between Lstat and open cannot block the Collector.
- Canonical DER PKCS#8 **Ed25519 only**, not ECDSA/RSA, PEM, malformed or alternate noncanonical encoding.
- Constant-time comparison with the independent operator-pinned SHA-256 of the public SPKI DER, with parsed private key bytes cleared when the preflight returns.

Only two opaque, **package-private** fields are returned: public SPKI DER SHA-256 and a domain-separated file-identity epoch, detecting atomic replacement even when the new key has identical bytes. The private key, its seed, path or signing capability do not leave the preflight call.

## Not provided yet

This module contains **no sign function**, key generator, key upload, UI, API, Server handler, Docker action or replacement TLS trust policy. It cannot issue an AppliedReceipt and is not an authorization to consume a nonce, deploy, or assert route absence. A future independent Collector service must control process identities, installer/provisioner permissions, key rotation and exclusive signed issuance. Rootless Docker and Windows require their own equivalent security contracts and currently fail closed.

P0-01 genuine Caddy-origin negative attribution, P0-02 continuous mutation epoch, actual issuer, ≤30s lease, PostgreSQL nonce consumption and current admin-only Applied API/Web/Mobile/Desktop invalidation remain separate prerequisites. Do not bypass any of them.

## Source verification

Synthetic key tests run as an unprivileged UID and cover successful Ed25519 DER/pin validation, wrong Server UID, malformed/wrong algorithm, wrong/missing pin, group-visible file/directory, hardlink, symlink, oversized/empty/FIFO key, setuid/setgid/sticky modes, deterministic raced final and ancestor symlink opens, canonical path requirements, nondisclosure by JSON marshaling and same-content atomic file replacement. Isolated Go Race and `go vet` passing is **not** a substitute for exact-head full xDrive Go Linux/Windows, true PostgreSQL, Host/Rootless and other CI jobs.

Production-only environment-specific acceptance remains **按用户决定跳过（未验收）**, without requesting production key material, accounts, credentials or captures. Security invariants, controlled source tests and exact HEAD CI remain mandatory.
