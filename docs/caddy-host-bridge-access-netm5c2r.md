# Host Control: standard Unix group/mode access (2026-10-27)

## Status

Host Control no longer depends on external filesystem POSIX ACL utilities or
packages. This supersedes the optional fallback introduced in #2193. xDrive
application-level authorization, CAS integrity checks and file sharing ACLs
remain unchanged.

For Rootful Docker without userns remapping, the fixed `state/control`
directory retains the host installer's Owner, receives Server GID `65532`
and mode `2770` (setgid inheritance). Running Server uses UID/GID
`65532:65532`. Host-produced observation files are mode `0660`, group
`65532`:

- `heartbeat`
- `caddy-runtime-status.json`
- `caddy-env-observed.json`

On a root-run trusted installer, the bounded helper may correct the **group
only** of this real directory and these three pre-existing regular,
non-symlink observations. It calls non-dereferencing `chgrp -h` so an
unexpected symlink cannot cause its target's ownership to change. It does
not chmod host-writable observation paths: the publishers already write 0660,
and an unexpected legacy mode must be inspected by the root operator.

On an unprivileged installer, an insufficient group permission only emits a
bounded root-remediation warning. No privilege escalation, installer package
installation, recursive chown, Caddy restart, certificate or database
mutation occurs. Rootless, userns-remapped and unverifiable Docker security
options disallow guessing a host numeric GID entirely.

## One-time repair (existing Rootful/non-userns deployment)

Use the actual installation directory. Example when installed by xuliang,
run in a root shell, after verifying Docker SecurityOptions:

```bash
XD_HOME=/home/xuliang/.xd
D="$XD_HOME/state/control"
test "$(id -u)" -eq 0 && test -d "$D" && test ! -L "$D" || exit 1
chgrp 65532 "$D" && chmod 2770 "$D"
for name in heartbeat caddy-runtime-status.json caddy-env-observed.json; do
  file="$D/$name"
  if test -f "$file" && test ! -L "$file"; then
    chgrp -h 65532 "$file" && chmod 0660 "$file"
  fi
done
XD_CONFIG_DIR="$XD_HOME" "$XD_HOME/bin/xdrive-server" doctor
```

Never run this numeric-GID repair blindly on Rootless/userns Docker, modify
the entire `~/.xd` tree or open any permissions with `chmod 777`.

## Verification

The read-only Doctor independently reports the real running Server's
`/host-control` bind path equality, numeric GID hint, running revision,
host-produced observation freshness and the running Server's own
`caddy-host witness-check`. A directory GID match alone does not prove
Server readability. A mismatched host GID is not automatically a failure if
the actual fixed bind matches and a fresh witness from that Server passes.
A mismatched bind, stale observation or unavailable witness remains visible.

Tests cover bounded root/non-root group handling, existing files, Rootless,
userns, malformed Docker security information, hostile symlinks, and
independent witness/mount results. Repository CI is not a substitute for
checking permissions on the physical production host.

## A long-lived observer can retain obsolete groups

Updating an installer's group membership does not update already-running
processes. Inspect the observer PID's `/proc/<pid>/status` `Groups` line, not
only `id <account>`. On Linux, an owner outside the directory's group can
silently clear setgid by running `chmod 2770`. Subsequent 0660 snapshots then
inherit its primary group and the Server's management reads can return 503,
even while the Caddy HTTPS listener remains healthy.

The read-only Caddy observer checks its actual groups against the existing
bridge directory before preparing or publishing observations. An obsolete
process exits without changing the bridge. This check does not guess mapped
GIDs or grant new permissions.

For an existing stale observer, first verify its PID, command, UID and
installation directory. Use that installation's `caddy-observer-stop` flag
to stop only the read-only observer; wait for it to exit, then run the
existing `server-control.sh start` from a fresh login with the required
supplementary group. An already-running main controller stays running.
Verify fresh snapshots remain 0660 with the correct group and execute the
running Server's `caddy-host config-check` repeatedly. Do not restart Caddy,
delete its state or broaden directory access to repair an observation error.

`scripts/test-caddy-observer-groups.sh` reproduces the actual Linux setgid
behavior with an isolated UID/GID fixture and verifies both stale-process
refusal and fresh-process publication readable by the Server UID.
