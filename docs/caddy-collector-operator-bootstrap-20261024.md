# Caddy P0-03B — independent, read-only Collector boot preflight

**Scope:** This is a standalone Linux binary for checking a root-pinned public identity and a separately owned Ed25519 key. It is NOT the independently trusted running Caddy Collector, does not sign receipts and must not expose or claim Applied.

## Operator-only trust contract

- Binary: cmd/xdrive-caddy-collector-preflight. It accepts no positional arguments, flags, environment overrides or HTTP requests.
- Fixed policy path: /etc/xdrive/collector/operator-policy.v1, opened root-to-leaf from / using NOFOLLOW, DIRECTORY, CLOEXEC and NONBLOCK. All policy ancestors must be owned by UID 0, neither group- nor other-writable, and free of special permission flags or symlinks.
- Policy file: root-owned, single-linked regular file, exact 0644 mode, at most 384 bytes. It contains only PUBLIC UIDs and a SHA-256 fingerprint of the DER SPKI of the Ed25519 public key. No private bytes, tokens, passwords or endpoints.
- Exact four-line LF-terminated policy format (with a terminal newline), in this order:

    xdrive.caddy.collector.operator-policy.v1
    collector_uid=1002
    server_uid=1001
    public_spki_sha256=<64-lowercase-hex-SPKI-DER-SHA256>

- UIDs shown are examples only. The operator must provision actual distinct UIDs out of band. The Collector must be non-root and exactly match collector_uid; root or shared-UID deployments fail closed.
- Private key directory is fixed at /var/lib/xdrive-caddy-collector and is the already-audited 0700 directory owned by the dedicated Collector UID. Only the file collector-ed25519.v1.pk8 is read there, in exact 0600 mode, canonical Ed25519 PKCS#8, with SPKI pin validation.
- Unsupported Windows and Rootless/same-UID deployments report unverified. No private certificate/CA trust policy is modified.

## What was intentionally not activated

No automatic installation or systemd service is shipped or enabled; no process is granted new Host, Docker, network, Agent, PostgreSQL or API permissions. The binary is a single-use, opt-in preflight building block, and positive exit code only means that the **local key policy** matched at that moment. It cannot prove Caddy negative-origin attribution, a continuous mutation epoch, original Host Operation binding, a 30s receipt or its durable one-time consumption.

Follow-up P0-03C still needs operator-controlled service lifecycle and rotation. P0-01/02/04/05/06/07/08/09 remain open in Issue #2075. Production-only inaccessible validation: 按用户决定跳过（未验收）. Source CI and security tests are mandatory.
