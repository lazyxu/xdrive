# Native iOS Photo background grant: Owner-root-only Go UploadSession aliases

This PR adds the *upload side* of the revocable Owner/Device/Root grant from
[#3164](https://github.com/lazyxu/xdrive/pull/3164). It reuses the **existing
Go UploadSession / CAS / quota / finalize** implementation, not a new writer.

## Endpoints: dedicated, never general authentication

All these paths require both `X-XDrive-IOS-Photo-Grant` (14-day
opaque separately revocable grant) **and** matching current
`X-XDrive-Device-ID` and `X-XDrive-Device-Token`. Every request rechecks
the current User/SessionVersion, live iOS Device, exact Owner Root and Server
installation through the grant middleware.

`/api/v1/ios/photos/background`:

| Method | Path | Exact ability |
| --- | --- | --- |
| POST | `/uploads` | Create or idempotently re-find **one original** using existing CAS engine |
| POST | `/uploads/resume-lookup` | Logically read-only lookup of sealed `ios_` HMAC key |
| GET | `/uploads/:id` | Existing Owner/Root/ios-key session status |
| PUT | `/uploads/:id/chunks/:index` | Existing single bounded 8-MiB SHA-verified CAS chunk |
| POST | `/uploads/:id/finalize` | Existing finalized Node SHA receipt |
| GET | `/receipts/nodes/:id` | Minimal current-Owner file hash/revision, only if a matching finalized original exists |

**No arbitrary directory creation, overwrite, rename, delete, copy, admin,
share, SourceRun or public endpoint can be reached with this grant.**

The create route requires the exact current Owner Root parent, `node_id`
absent, conflict policy `fail`, no overwrite/revision/MD5, exact 8-MiB
chunk size, lowercase whole-file SHA256, 256-bit `ios_` HMAC resume key,
and a bounded `-xios-<24lowerhex>-<12lowerhex>` destination filename.
One item is bounded to **1 GiB + 1 MiB** (Live ZIP manifest/headers
overhead). Existing Server max-file/quota/capacity still apply.

Every status/chunk/finalize request first verifies the current session's
exact Owner, parent Root, absence of existing target Node, HMAC namespace,
fail policy, target name, full SHA and allowed size. Only then does a
*dedicated handler* set Gin's User ID for the existing writer. The general
`requireAuth` still rejects the opaque grant. No extra upload session
writer or CAS blob schema is introduced. Readback returns only minimal
Node name/parent/size/revision/hash and requires a finalized matching iOS
UploadSession record.

A missing/ambiguous/expired session remains unknown; it is NEVER
permission to mint a new fingerprint or delete a photo.

## Critical limit for URLSession background upload

The long-lived grant and Device token **must never be attached to an
Apple background URLSession file task** until redirect-fencing is
independently solved. Apple's background URLSession redirect callbacks
differ from ephemeral foreground sessions; a redirected request could
leak long-lived credentials. Use these protected routes inside a running
BGProcessingTask with ordinary URLSession configured to reject redirects,
or add separately scoped, short-lived, per-chunk one-use background
tickets before transferring while the app is suspended.

This server PR alone does not implement a native background Runner, secure
Keychain grant provisioning, file-URLSession tasks, or OS-relaunch
reconciliation. It does not claim unattended background auto-sync works.

## Security tests

- Exact rooted, name-tagged, `ios_` HMAC, fail-on-conflict, 8-MiB, SHA
  and size admission checks (including malicious attempts to use arbitrary
  Node IDs, local Push keys or overwrite).
- Grant test from #3164 still proves Owner/Device/Root/SessionVersion/
  Server-instance and revocation/expiry fencing.
- Exact-head Go compilation, authenticated PostgreSQL HTTP integration,
  CAS chunk/redirect and mobile real uploads remain required before
  merging. Apple iPhone/SideStore/locked-screen proof: **跳过（未验收）**.

This PR is stacked on #3164 to reduce redundant CI work; the earlier
grant PR's current HEAD is not changed.
