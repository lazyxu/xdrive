# iOS native device enrollment — identity-only (no Agent execution)

This change extends the existing Owner-authenticated POST /api/v1/devices
to accept **platform=ios**. The Server still generates a 32-byte random
device credential, stores only its SHA-256 digest, and returns the raw
credential once in the registration response. Existing Desktop windows,
linux and darwin enrollment is unchanged.

An iOS device credential is intentionally **identity-only**:

- With a current **same-Owner** access token and matching device ID plus
  device secret, GET /api/v1/devices/self returns only device_id.
- POST /api/v1/devices/self/heartbeat may record credential-authenticated
  presence. It cannot create a Source, bind a Root, run an Agent task, upload
  a resource, or grant a local folder.
- Existing Source/local_root authorization uses
  clientDeviceCredentialMatches, which explicitly rejects an iOS platform.
  The identity-only helper is used only for /devices/self and heartbeat.
- Revocation and cross-Owner checks retain the existing Server authorization.

An iOS app must never register as `darwin` to gain desktop privileges. The
intended native caller will keep the enrollment token in a ThisDeviceOnly
Keychain item partitioned by Server installation ID + numeric Owner and
not inject it into PWA JavaScript, a URL, a generic log, or the PhotoKit
media manifest.

## Not yet authorized

Identity enrollment does **not** constitute permission to create an iOS
PhotoKit Root or to run a local_folder Source. A separate designed
photo-only Device/Root capability and persistent Owner ledger are still
required for trustworthy native automatic incremental backup. Ordinary
user-authorized upload is still handled by /api/v1/uploads with normal
Owner ACL and does not grant Source/Device backup rights.

The Go security regression covers iOS Owner/other-Owner identity proof,
heartbeat, revocation, secret absence from responses, and a forbidden
local_folder Source creation even when a valid iOS device token is supplied.
The real-device enrollment, SideStore Keychain restoration and photo sync
physical acceptance remain **跳过（未验收）** until performed; source and
security tests are never skipped as an alternative.
