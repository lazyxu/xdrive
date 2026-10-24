# Caddy P0-03C1 — Linux Collector preflight systemd sandbox contract

Status: SOURCE-ONLY, OPT-IN. This unit is not installed, enabled or running and is not the independent Caddy observer, signer or Applied issuer.

## Security boundary

- Source unit: deploy/xdrive-caddy-collector-preflight.service, deliberately without an [Install] section, auto-start, WantedBy, restart, EnvironmentFile, extra commands or sockets.
- One-shot executable must be provisioned out of band by a trusted Linux operator at /usr/local/libexec/xdrive-caddy-collector-preflight, as root-owned executable bytes built from cmd/xdrive-caddy-collector-preflight. This PR provides NO installation or escalation path.
- Runs under the separately provisioned non-root xdrive-caddy-collector User/Group, not Server, Agent, Host Manager, root or Docker group. The existing program rejects a UID different from root-owned policy collector_uid or equal to server_uid.
- NoNewPrivileges, empty capability bounding/ambient sets, no IP traffic or external network, no Docker socket, read-only system filesystem and pinned policy/key locations, blocked kernel and namespace changes.
- No API, IPC, signing, token, Caddy route mutation, nonce consumption or DB access. A one-shot success only means the public pin and private key preflight passed locally and Applied is still DISABLED.
- If dedicated UID, operator-owned policy/key, root-owned executable or mandatory systemd restrictions are not available, report UNVERIFIED; do not downgrade to a permissive unit.

## Test contract and remaining work

The Go TestCaddyCollectorPreflightSystemdSandboxContract source regression parses the entire systemd file using an exact directive allowlist. Added commands, environment overrides, privilege grants, auto-enable or weakened restrictions are rejected. Local standalone Go 1.23 test PASSED. Local systemd-analyze verify accepted the unit directives, with the expected warning about the executable not being installed. Those checks do not replace accurate-head full xDrive CI or a live service run.

The unit does NOT install itself, does NOT start after upgrade and does NOT fulfill P0-03C. Remaining: operator-only provisioning, real minimum-privilege long-lived Collector, key rotation, authorized trusted Host evidence. Never give the least-privilege Collector unrestricted Docker socket/group, which effectively grants Host-root control. P0-01 true negative-origin attribution, P0-02 continuous config mutation epoch, P0-04/05 receipt issuer/nonce and P0-06 to P0-09 stay open in Issue #2075.

Inaccessible production-specific acceptance: 按用户决定跳过（未验收）. Code-level security and exact CI are mandatory.
