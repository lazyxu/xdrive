# iOS Photo background grant — Owner/Device/Root admission v1

The existing iOS ClientDevice token grants **identity only** (and a read-only
presence heartbeat); it MUST NOT become a generic Desktop Source/Root token.
The WKWebView's short-lived login JWT / HttpOnly cookie MUST NOT be cached
for BGProcessingTask or exported as a long-lived native background token.

This PR adds a *separate, revocable* native photo-background admission record
to PostgreSQL, without broadening the normal `requireAuth` middleware.

## Issuance and lifecycle

- `POST /api/v1/ios/photos/background-grants` requires a current regular
  **Owner access JWT** under `requireAuth`, and independently verifies
  `X-XDrive-Device-ID` plus `X-XDrive-Device-Token` for an already-enrolled
  **unrevoked iOS device belonging to that exact Owner**.
- Root ID is resolved by the Server from the current Owner's real root
  directory; the client cannot select a foreign parent or claim arbitrary
  Source/Root rights. The Server's persisted installation ID and the User's
  SessionVersion are recorded. No grant can be issued if the installation
  identity is unavailable or password rotation is required.
- A cryptographically random 256-bit opaque `grant_secret` is returned once
  over authenticated TLS with `Cache-Control: private, no-store`. Only the
  SHA-256 digest is stored. The native client must persist the raw secret in
  **ThisDeviceOnly Keychain** and never pass it into JavaScript.
- Issuing a newer grant atomically revokes the prior active grant(s) for
  that Owner and iPhone. Expiry is **14 days**.
- `GET /api/v1/ios/photos/background-grants` lists only the current
  Owner's safe grant metadata. `POST .../:id/revoke` lets the Owner revoke
  an individual grant **without having the lost iPhone**. Revoking the
  installed Device or changing the user's SessionVersion independently
  invalidates the grant.
- Native proof requires **both** the opaque
  `X-XDrive-IOS-Photo-Grant` header and the original independently stored
  `X-XDrive-Device-ID/Token` pair. It checks current User enabled/password
  state, exact Owner, iOS platform, live Device, root, Server instance,
  SessionVersion, revocation and expiry on every request.
- `GET .../proof` reports scope and `upload_authorized:false`; a valid
  grant may be rotated at `POST .../rotate` only while still valid and
  with the matching Device secret. Rotation revokes its predecessor in the
  same database transaction.

## Critical security boundary

**These endpoints DO NOT grant write access to existing**
`/api/v1/uploads`, `/api/v1/nodes`, admin or
SourceRun. Their middleware does not set generic `userID` in Gin context,
and the random grant is not a user JWT. A distinct reviewed set of
Owner/Root-scoped iOS upload APIs and native background file-URLSession
transfer state is still required before enabling real BG uploads. A
BGProcessingTask system wake is not a Server authorization.

Tests verify high-entropy canonical token format and fail-closed User,
Device, Root, revoked, changed installation, expiration, session and
platform conditions. Actual authenticated Server/DB integration and native
Keychain consumption are separate follow-ups.

## How this reduces the MVP gap

The shared iOS UI can in the future make one explicit request through
an already-enrolled native device after the user confirms background
backup. The native app can store and renew the grant without caching Web
login cookies; the user can revoke it remotely.

Until native grant issuance, scoped upload endpoint routing, background
file transfer, encrypted journal replay, and system scheduling are linked,
**automatic locked-screen uploads remain unimplemented**. The existing
#3147 frontmost-App timer is a distinct and narrower capability.

Physical iPhone, SideStore, real BGTask launch, network ACK loss,
post-revocation in-flight upload and 100k persistence:
**跳过（未验收）**. Never mistake grant existence for photo upload success.
