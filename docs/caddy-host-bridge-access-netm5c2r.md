# NET-M5-C2-R · Fix the Host Control permission blind spot and verify the actual running Server

## Verified source failure mode

The existing xDrive installer sets its Server container runtime to UID/GID `65532:65532` but explicitly supports running the host installer as an ordinary non-root operator. Both `prepare_host_layout` and the long-running `server-control.sh prepare_dir` attempted `chgrp 65532` on the fixed `state/control` bridge with `|| true`. A host account not permitted to change group ownership can still create fresh `heartbeat` and `caddy-runtime-status.json` files under its own group; the Server running under GID 65532 may then be denied access to `/host-control`, while the standalone Caddy HTTPS reverse proxy keeps serving users. This is a **code-level permission blind spot**, not physical proof that the user's host has this exact failure.

The previous source fixes #2155, #2161, #2171, #2182, #2184, #2189 are merged; a GitHub source merge never updates the user's running Server image and resident Host Control process. Old System Dependencies text remains consistent with a still-running older image; live host-version evidence is required.

## Narrow non-root Rootful permission compatibility

The installer now checks the exact fixed `$STATE_DIR/control` real directory after writing `XD_HOST_CONTROL_HOST_DIR`. If numeric group already equals the intended Server GID, no action is needed. If it differs, a **Rootful Docker setup without userns-remap** and a verified host-directory owner can use available POSIX `setfacl` to grant only numeric Server UID 65532 `rwx` to the *existing fixed bridge*, with a default ACL for future observer files. Only the two fixed already-existing `heartbeat` and `caddy-runtime-status.json` regular, non-symlink observation files get narrowly scoped `rw-` access. No world-readable directory, no arbitrary path, and no modification of host Caddy data, certificate volumes, AliDNS, Postgres, Compose, permissions on other services, or container identity. A failed ACL or absent `setfacl` is reported and does not restart/stop Caddy or mutate its runtime. Unknown, malformed or missing Docker `SecurityOptions` and unreadable directory group metadata also fail closed; only a verified compact Docker JSON array with no `userns` marker permits the narrow ACL fallback. Rootless and userns-remapped setups deliberately **skip guessing the host-mapped UID**, requiring actual Server witness verification and independent operator repair.

Important: the intended Host Control bridge can carry administrative control requests. Named UID access is limited to the same Server principal that the original numeric-GID bridge was designed to trust; this is not an unauthenticated browser or public-access fix.

## Source-aligned Doctor evidence

`xdrive-server doctor` already compared host snapshot freshness with the running Server's `caddy-host witness-check`. It now adds three *nonsecret, read-only* checks:

1. Inspect the **current Compose Server container** for one fixed `/host-control` bind mount, canonicalize its source against `XD_HOST_CONTROL_HOST_DIR`, and return only allowlisted `mount-missing`, `mount-source-mismatch`, `mount-invalid`, `host-directory-unavailable`, `matched-metadata-only` or related reason codes. No source path, container ID or raw Docker inspector output is printed.
2. Check only numeric directory group alignment with `XD_SERVER_GID` as a hint. ACL and userns can make this hint nonauthoritative; **only a successful running Server witness** is proof of usable observability.
3. Make a bounded `xdrive-server version` call **inside the running Server**, parse only the exact `commit: <40 lowercase hex>` line, and compare against `XD_RELEASE_COMMIT` when pinned. This catches a stale or misrouted running binary without exposing commit messages, arbitrary stdout, secrets, or claiming it is the newest available GitHub release.

The shared Web/Mobile Web/PWA/Desktop System Dependencies screen has one extra operator hint directing actual host version/mount/GID/ACL checks when the trusted witness remains unknown. It does not fabricate Caddy health, HTTPS identity, WAN reachability, an imported AliDNS credential, or an Applied Receipt.

## Acceptance

Existing `scripts/test-server-doctor.sh` fixture checks matched/missing/mismatched bind mounts, mismatched current Server commit, malicious command output, and the fixed installer ACL helper against Rootless/userns/matching-group cases with no broad host mutation. Existing Desktop Caddy contract validates the exact shared UI, ACL scope and stable legacy metadata-only checks. Require source-exact full 77+ job CI including real PostgreSQL API Go Race, Go/Web/Desktop Linux/Windows, Caddy/Rootless, installers/artifacts, single-work Final Gate, plus current GitHub clean mergeability before Ready/Rebase.

Physical production `xdrive-server status; xdrive-server doctor` and actual LAN/domain CA/SAN/WAN login must still be checked after upgrading the actual Server/Host Control. `apply_supported=false` and the NET-M5-C1–C4 independent Rescue, signed Host apply, watchdog rollback and off-host verification gates remain unchanged.
