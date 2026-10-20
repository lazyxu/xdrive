# NET-M5-C2-L · Restore read-only Caddy observation on an already-deployed xDrive

## Confirmed code-level gap

The **precise** admin reason "Caddy 宿主状态快照缺失" means the Server found a fresh, regular Host Control `heartbeat` file but no `caddy-runtime-status.json` in the same trusted shared mount. It is not evidence of a stopped, broken or never-installed Caddy instance.

The xDrive installer copies a new `bin/server-control.sh` and calls `server-control.sh install`. Before this correction, `start_cmd` observed any still-live `runner.pid` and returned without updating the running Bash code. A pre-feature daemon may continue refreshing `heartbeat` indefinitely while never creating the new Caddy runtime snapshot. Calling the new Server API cannot fix this by itself.

## Compatible observer without disrupting Caddy

- The current host-control daemon records **its own script SHA-256 + PID** on startup, as a nonauthoritative freshness/version hint. On `install`/`start`, a live host runner with a missing or mismatched marker remains **untouched**; it may be processing a server upgrade.
- A separate, fixed, read-only `server-control.sh caddy-observe` process starts with a dedicated nonblocking flock. It samples **only** the existing fixed `xdrive-caddy` container via the repository's original `caddy_host_refresh`: constrained Docker inspect/exec, local TLS/certificate verification, single-generation fences, in-container config digests, and SHA-only local identity checks. It atomically refreshes the same sanitized status every 15 seconds.
- This does **not** stop/restart Caddy, change listener ports, Compose, domain, private IP, AliDNS secrets, local CA or Host Pending reservations; it cannot grant Host Apply. It must not kill or block the old update runner.
- At the next ordinary trusted new-runner start, the code marker becomes current and the supplemental observer exits on its own. Subsequent script updates cause the observer to reload the newest read-only implementation under the single-instance lock. An operator stop uses a cooperative stop marker rather than signaling an untrusted observer PID.
- If the host's Docker/openssl/curl/CA probe fails, the original Server reader and DTO stay unknown/unavailable. Never infer success from an HTTP self-proxy or an untrusted browser request.

## Dashboard and configuration semantics

The shared Web/Mobile Web/PWA/Desktop lifecycle now labels a **freshly observed** Caddy deployment as "宿主已观测", without counting any admin desired revision as applied or marking activation `verified`. Lack of observed evidence stays unknown. Caddy's external reachability and client trust of the private CA remain unverified until physical client acceptance.

A Caddy that worked *before* System Dependencies management existed can have HTTPS desired revision `#0` and AliDNS encrypted-credential revision `#0` in PostgreSQL. These denote **unmanaged in-app edits**, NOT missing host .env/DNS-01 values. Never blindly import, rotate or display host credentials; no operator consent or secret transfer is performed. Actual Host Apply and restart remain `apply_supported=false` until independent signed operator, DB↔Host CAS, verified rescue, timeout rollback watchdog, off-host both-on/one-on tests and immutable Applied Receipt are established.

## Verification

The original Bash fixture simulates a fresh legacy heartbeat and live runner PID **without** the new snapshot, verifies a standalone observer recovers a valid local status without modifying an in-progress update request, then stops it safely and confirms no duplicate observer is launched for a current runner. A Desktop shared Signal regression checks deployed-vs-unconfirmed lifecycle labels and that no false applied-revision counter is added. This is source+mock verification only, not evidence of any user's physical host state.

## NET-M5-C2-N · Same-source Runner snapshot repair (2026-10-20)

**Confirmed follow-up gap:** The C2-L observer only started for a PID+script-SHA mismatch, and exited before sampling when the live runner's marker matched the installed script. A same-version runner can be alive yet temporarily blocked in an update, leaving `caddy-runtime-status.json` missing or older than the Server's 45-second validation window. Thus the previous fixture explicitly accepted the user's persistent `snapshot-missing` state.

The trusted installer already invokes `server-control.sh install` after a successful official deployment. Now `start` checks both the runner source marker **and** the fixed snapshot file's local mtime (45-second freshness, 15-second future tolerance). Missing, symlinked or expired evidence launches the existing locked **read-only** compatibility observer. The observer independently samples the fixed `xdrive-caddy` until the main runner has both matching source and a fresh snapshot. It never kills the main runner, accesses arbitrary URLs, writes Caddy/Compose/.env/credentials, applies desired revisions, restarts Docker or claims outside TLS/admin-login verification. A single observer's existing `flock` prevents duplicates. The Server continues enforcing full JSON, Host Control heartbeat and TLS validation; an observer write alone is not proof of HTTPS or an applied revision.

The original Bash/Docker fixture now includes same-source missing/expired snapshot recovery and verifies one-shot observer cleanup, a stable fresh snapshot, unchanged host update `active.json` SHA and still-live runner PID. The Server diagnostic tells operators that missing witness is not evidence of an uninstalled Caddy and points to the read-only sampler/shared mount. This change does not access or restart a real customer's gateway, so deployment + external-device checks are still required.

## C2-N follow-up · prevent own-snapshot false handoff

The first C2-N exit rule incorrectly treated the observer's own fresh file as proof the same-source primary Runner had resumed its 15-second sampling. During a prolonged Server upgrade this can stop the observer after its first 15-second cycle, allowing the snapshot to become stale again. The corrected control script emits a private, source/PID-bound `caddy-main-sample.sha` pulse **only after the primary Runner's own Caddy sampler completes**. The observer captures the old pulse at startup and exits only after a *new* matching pulse appears and the fixed snapshot is still fresh. On a stuck/busy Runner it remains in the bounded one-observer read-only loop and never interferes with `active.json`. A real 15-second fixture verifies continued polling before genuine handoff, unchanged active update state and no Caddy restart/Apply. Neither the pulse nor the snapshot proves WAN reachability or that a desired admin revision was applied.
