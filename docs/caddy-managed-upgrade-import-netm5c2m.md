# NET-M5-C2-M · Upgrade adoption of an existing Caddy into System Dependencies

## Purpose

An older xDrive Caddy deployment can already serve its LAN private-IP HTTPS and/or public domain HTTPS and still show **administrator HTTPS revision #0 / AliDNS revision #0** in the newer **系统依赖** page. Those values mean the new PostgreSQL management records have not been initialized; they do **not** mean that a working container, DNS-01 account or Caddy CA is absent.

The installer already replaces older Compose deployment files with the versioned fixed Caddy/Web image and retains the xDrive Caddy data/config volumes. This change **also imports the verified, currently deployed HTTPS identities and the existing paired DNS-01 credentials into the managed administrator records**. Users should not need to re-enter a working AliDNS account merely to see or subsequently edit the instance's configuration.

## Migration transaction

1. Existing server installer validates the persisted domain, canonical RFC1918 IP and dual-entry invariant, preserving legitimate HTTP-only compatibility upgrades rather than silently enabling a new login entry. Existing private host configuration, Caddy CA/certificate volumes and rollback snapshots remain intact.
2. Stage 8 waits for real Server, Caddy reverse-proxy and each enabled HTTPS entry, using normal trusted TLS/CA and hostname/IP SAN verification. No `-k`, no disabled chain verification and no synthesized success.
3. **Before** clearing the database-rollback flag or committing the upgrade, the trusted host installer streams four NUL-delimited fields (domain, LAN IP, optional AliDNS ID and secret) through an ephemeral private stdin pipe to the new fixed `xdrive-server caddy-host adopt-stdin` command **inside** the Server container. No secret is placed on the CLI, in host temporary JSON, in a URL, in audit metadata or in browser-visible data. CLI input is bounded to 1024 bytes and rejects unexpected arguments/fields.
4. The server's existing ConnectorSecrets keyring AEAD-encrypts the paired credential. One PostgreSQL transaction checks the sticky Caddy Host Pending fence, records the authoritative host HTTPS desired revision 1 with `host-import` provenance, inserts one immutable history revision, inserts encrypted AliDNS revision 1 only when no prior administrator-managed credential exists, and records a **redacted system audit**. All steps roll back on any failure. The original host `.env` remains in place until a future separately verified Host Apply retires it.
5. Import is idempotent. **Existing database-managed HTTPS configuration and AliDNS credentials always win**; repeated updates never overwrite them or rotate provider credentials. Two replicas/host operators racing the first import admit at most one revision. Invalid addresses, missing keyring, missing reservation table, malformed input or audit failures cannot leave half-migrated configuration.
6. Existing host `Caddyfile` is retained as an operator-private 0600 `state/legacy-caddy/original.Caddyfile` if present before the old host file is removed; no custom site content or key is publicly exposed.

## What appears in the shared management page

The existing Web/Mobile Web/PWA/Desktop shared **系统依赖 → Caddy** shows imported IP/domain state with provenance `host-import`, plus the encrypted AliDNS management credential state. The standard revisioned save, rollback, explicit credential reveal/rotation and seven read-only prerequisite checks remain accessible to a real administrator with existing permissions. This is a **single configuration inventory**, not a second parallel set of Caddy controls.

**No false deployment claim:** Imported administrator records are **not** a signed, physically verified applied revision. Even when the old gateway was tested successfully during upgrade, later in-app edits still do NOT change the live Caddy by themselves. `apply_supported=false` and `restricted-apply=blocked` remain until trusted signed operator authorization, Host/DB CAS, independent Rescue, secure secret handoff, bounded Caddy restart, detached timeout rollback watchdog, off-host positive/negative TLS and administrator-login verification, and an immutable applied receipt all exist. The installer does not expose Host/Docker actions through the web UI.

## Boundaries / unsupported migrations

- If the earlier deployment has **no valid HTTPS entry**, preserve legacy HTTP-only mode without importing a fictitious IP or domain. The administrator must provision trusted HTTPS separately.
- Arbitrary third-party/custom Caddyfile directives are **not automatically translated** into the fixed xDrive Caddyfile. The original file is retained privately for manual review. Do not advertise custom hosts as migrated or delete their provenance.
- Credentials configured on the host are copied into a separately encrypted database record, not removed from the running Caddy environment. A staged edit or credential clear does not revoke a provider key still used by the current host.
- A real customer host, off-host browsers, DNS credentials and CA root were not accessible to this CI-only implementation; tests use isolated PostgreSQL, bounded CLI parsing and installer contracts.

## Verification

Genuine PostgreSQL separate-schema tests exercise two independent pools racing eight imports, a single immutable import/history/audit, AEAD round trip and no plaintext, replay/host drift no-overwrite, LAN-only without AliDNS, invalid provider/host input and missing-Pending schema fail closed. Go CLI tests reject oversized, malformed and surplus NUL fields. Shared Desktop/source acceptance checks ensure the migration occurs **after** authentic HTTPS checks and **before** the upgrade rollback commit. All new changes must pass exact-head full 77+ CI, real PostgreSQL API Race and Final Gate prior to merge.

## NET-M5-C2-M source CI correction and existing-management replay

The first implementation HEAD `62e421701f0ade10be9c8fe1010b15da472d8ad9` failed its own [77-job CI #39251377549](https://github.com/lazyxu/xdrive/actions/runs/39251377549) at the Go formatting gate and a Desktop oracle that matched the **definition** of `commit_upgrade_transaction` instead of its invocation. Both are source/test defects, not evidence the installed Caddy migrated. The corrected one-work HEAD is built on a later complete master including separately merged Host Control stale-runner observation (#2155) and Pending editor fence (#2152). Those controls must be retained.

Migration now also checks for a pre-existing administrator HTTPS row **before demanding a legacy AliDNS secret or running AEAD**. A second upgrade should not fail simply because obsolete host-side secret material is no longer supplied after management ownership was established. When an independently saved AliDNS row exists but no HTTPS row does, that encrypted credential wins; importer records only missing HTTPS identity, never overwrites or exposes the prior credential. First-time domain adoption without either a valid provider pair or an existing encrypted credential still fails closed.

The original installer must not claim an external or arbitrary Caddy deployment was automatically translated. It migrates only the **official xDrive Caddy** with supported `XD_DOMAIN`/`XD_LAN_HTTPS_IP` identities, verified local/CA/TLS endpoints, and the managed Docker edge. Custom Caddyfiles are preserved privately for review; unsupported external sites are not silently mapped. The signed host apply pipeline remains separately unfinished.
