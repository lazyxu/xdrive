# Native iOS Device enrollment client (identity-only)

The new `XDriveIOSDeviceEnrollment.shared` actor is an internal component.
It deliberately has **no automatic startup call or visible enrollment button**
until the separately reviewed Server PR #3071 has passed Go security checks
and been merged. Server versions without `platform=ios` will reject it.

## Enrollment contract

A caller must first have a current, Server-verified
`XDriveNativeOwnerRoot` (HTTPS origin, persistent installation ID,
numeric Owner ID, root node ID, username) and a native **memory-only**
access Bearer. The App does not obtain this from the PWA WKWebView Cookie.

An explicit `enroll` request:

1. Re-queries the same Owner and root before touching Device APIs.
2. Checks the exact current Owner-scoped Keychain slot; an existing
   unverified credential is not automatically replaced by a new Device.
3. Calls the existing Owner-authenticated POST /api/v1/devices with
   platform `ios`, a bounded display name and version; refuses redirects
   and invalid system-trust HTTPS. The API may require Server #3071.
4. Checks the returned platform, name, UUID and one-time device secret,
   then saves that credential in an isolated WhenUnlockedThisDeviceOnly
   Keychain slot scoped to Server origin/instance + Owner + root.
5. Calls GET /api/v1/devices/self with the **same Owner Bearer and the
   device ID/secret** before reporting verified identity. A failed remote
   check leaves the Keychain credential intact for a later **read-only**
   `verifyExisting`, rather than silently creating another Server device.

The raw device secret never enters JavaScript, URLs, PWA session state,
photograph metadata, logs or the encrypted sync ledger. Error objects do
not embed the response body or secret. No background registration occurs.

An iOS Device is identity/presence only. It does not grant a Desktop Agent
local_folder Source, Source executor, local Root binding, photo bytes upload,
or PhotoAsset pairing. This remains true even after the device is registered
and GET /devices/self succeeds.

## Error handling

- A lost POST registration ACK has an unknown Server-side result. **Do not
  silently retry**, even though the current client may not know its Device
  secret. An explicitly user-authorized reconciliation/re-enrollment UX must
  separately handle orphaned devices.
- A rejected/revoked/Owner-mismatched Keychain device is not silently
  deleted, rotated, or reused for another Owner or Server.
- If device-level Keychain save fails after a successful registration, a
  one-time orphan device may remain on Server; it cannot be reported as a
  verified installed device. Follow-up UI must explain this uncertainty.
- This proof does not replace a verified PhotoKit Source/Root grant or the
  encrypted per-resource sync intent ledger.

## Acceptance

Exact-head Xcode native iPhoneOS IPA compile and Server #3071's Go
credential/Owner/revocation/Agent denial checks are required before
wiring the UI. Actual iPhone Keychain, SideStore, revoked Device,
expired bearer, 100k photo library, and no-secret-leak verification are
**跳过（未验收）** until explicitly performed. Never mark missing
physical evidence as tested.
