# Android native device identity-only registration for photo backup

**2026-10-30, Android Photo/Video backup MVP dependency.**

The Go Server previously admitted `platform=ios` as a narrow native
device identity, but rejected `platform=android`. An Android App could not
register its own owner-scoped installation credential. This patch changes
only the existing device admission and Agent credential fence; no
new Server upload writer, Agent execution grant, Source kind, schema
or shared API is added.

## Contract

- `POST /api/v1/devices` accepts `platform=android` for the current
  authenticated Owner and returns one random registration token only
  at creation; Server stores only its digest.
- `GET /api/v1/devices/self` and
  `POST /api/v1/devices/self/heartbeat` allow a registered,
  unrevoked **same-Owner** Android identity token.
- `clientDeviceCredentialMatches` **rejects Android and iOS**
  identity-only credentials for existing Desktop Agent,
  local-folder Source, Root binding and worker execution paths.
- Other unknown client platforms (e.g. browser `web`) remain denied.
  Desktop Windows/Linux/Darwin credentials preserve existing capability.
- Owner mismatch, missing credentials, revocation and replay fail with
  the same read-only identity semantics as iOS.

## Not automatic backup yet

Android must still implement a native enrollment/credential store,
server-instance/Owner/Root proof, explicit photo permission,
Go UploadSession receipt verification and a foreground/background
incremental runner. The server change alone does not create a
photo backup Source or grant Agent capabilities.

## Tests

- Integration: real Android register, opaque hashed token, same Owner
  `devices/self` and heartbeat, different Owner denial, post-revoke
  denial and local-folder Source escalation denial.
- Existing iOS identity-only and desktop Agent tests remain; the invalid
  platform negative case is changed from Android to unsupported `web`.
- Full relevant Go/API and exact-HEAD required CI/Final Gate before
  master merge. Real installed-device verification: **跳过（未验收）**.
