# Photo content identity and face analysis

## Identity contract

Gallery's photo identity is `(authenticated Owner, content_key)`. A single
original uses `sha256:<full original SHA-256>`. A multi-resource photo uses
`photo-bundle:v1:sha256:<canonical manifest digest>`: the domain-separated
manifest includes photo kind and each complete original's role, digest and byte
length. Burst sequence order is significant. Live still/motion and RAW/rendered
roles are authoritative; pairing is established by the existing media indexer,
never by similar names or face matches. Container packaging is not an original;
its verified complete members determine the bundle identity.

Names, paths and source devices are provenance. Within one Owner, equal complete
content has one Gallery item, shared annotations and the union of album/source
memberships; all filesystem copies remain. Byte differences, including EXIF,
produce different identities. Any original changing creates a different bundle.
An identical still in two different Live bundles does not collapse those bundles.

`PhotoAsset.ID` remains an internal relational surrogate and old-client field.
`PrimaryNodeID` is only the current authorized delivery locator. Neither can
rewrite a populated content key/manifest. Node/File/CAS, versions, ACLs, upload
receipts and filesystem deletion protocols retain their existing ownership.
A bare digest grants no access and is not a public CAS URL.

## References, albums and migration

`PhotoAssetOccurrence` stores each source's complete original evidence, including
parent hash and byte ranges for derived container members. Gallery queries check
the full current bundle and active occurrence against Owner, Node/File digest,
size and deletion state. Deleting or replacing one copy can hand delivery to
another equal copy. When no valid copy remains, the old photo is hidden. Gallery
does not independently pin its CAS bytes; existing file/version/trash retention
continues to govern storage. Hidden human annotations can be reused on restore.

Startup migrates the added tables/columns and removes the old primary-Node FK and
Owner/primary unique index. Owner reconciliation promotes complete verified
legacy originals and folds duplicates transactionally under the Owner lock.
Favorites are ORed, tags/people labels unioned, distinct descriptions retained,
and manual albums, saved people, covers and edit references preserved. Replaced
or incomplete legacy evidence is never attached to newly uploaded bytes. An
Owner-bound identity alias records each folded legacy ID and a snapshot of its
human-owned data. This is a reconciliation record, not a public alternate ID.

Migration is idempotent. A database trigger rejects rewriting populated
Owner/key/manifest or a legacy writer changing a keyed evidence identity. An old
Server binary must not run concurrently with the upgraded writer: downgrade
requires a coordinated pre-upgrade database restore, not deleting the trigger
or reconstructing duplicate metadata heuristically. The migration test recreates
the old locator FK/index and verifies repeated upgrade and source handoff.

## API and platform use

- `GET /api/v1/media/content/:contentKey` resolves an authorized current photo.
  `/sources` returns at most 50 source Nodes with a numeric `next_cursor`.
- Favorite, tags, people labels and description accept content routes. Batch
  mutations and manual album addition accept `content_keys`; mixed hash/Node
  selectors are rejected. Legacy Node routes resolve the same canonical photo.
- Album removal and custom covers accept the content key; album revision checks
  still apply. Content covers survive locator replacement.
- Web/PWA/Desktop share selection identities, annotation/album contracts and a
  bounded source inspector. Desktop uses a closed operation allowlist through
  the existing authenticated Agent, including read cancellation.
- Android uses hash identity for Gallery selection/annotations/albums and native
  person pages. iOS uses hash identity for cloud timeline rows and native person
  pages. Both use existing Owner-authenticated native Viewer/delivery paths.
  Delivery still verifies the actual Node revision; a changed locator can require
  reopening a preview. PhotoKit local identities remain platform-owned.

## Face completion and grouping

Face result fingerprints bind canonical content plus preprocessing version;
model and embedding versions remain separate. The signed preview transport
keeps its existing preview fingerprint. Before writing completion, the runner
checks the current complete content, Owner/session, model, input, running state
and claimed attempt. A late result cannot complete a replacement or a newer
attempt. Equal-content source handoff is allowed. Queries reject obsolete face
evidence immediately, even before reconciliation. Duplicate file copies do not
manufacture multiple observations for a suggested person.

Suggested/confirmed person lists are bounded and Owner-scoped. iOS/Android
provide native group browsing and an explicit face reanalysis confirmation.
Reanalysis accepts only a verified `202` receipt for the current Owner and face
kind; a lost receipt is not automatically replayed. Automatic analysis and manual
backfill continue through the existing worker/admission policy.

## Provisioning and validation boundary

This change repairs content/result integrity and all-platform access. The shared
Photo Intelligence first-enable bootstrap (private socket/token connection and
model host creation) is owned by the separate [OCR PR #4012](https://github.com/lazyxu/xdrive/pull/4012).
An installation without those connections still needs that Server upgrade and
the existing explicit host enable action. This branch does not claim an absent
model is healthy or enable production implicitly.

Local validation includes PostgreSQL migration/integrity/Owner regressions,
real YuNet/SFace → Go worker → PostgreSQL → Gallery grouping with a pinned public
portrait, Web/Desktop contracts and actual Android compilation/unit tests.
The real-model test isolates unprivileged containers on an internal network,
without exposing the host Docker socket. Exact-HEAD CI runs the same models and
the full iOS build; source checks alone are not an iOS build. Production
192.168.2.4 and physical devices: **跳过（未验收）**.

The 100k SQL-only paired measurement is recorded in the
[performance registry](performance-test-registry.md#photo-content-binding--100k-sql-paired-measurement-2026-11-07).
It does not measure indexing, 100k physical originals, face inference or native
UI throughput, and the full integrity count remains about one second.
