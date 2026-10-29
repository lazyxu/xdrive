# iOS native foreground original-video increment

The existing iOS Photos exporter already stages a genuine authorized
`PHAssetResourceType.fullSizeVideo` (or `.video` fallback), but the
foreground Owner Files backup deliberately skipped every video. This change
adds actual original-video UploadSession writes **without introducing a second
queue or server writer**.

- Same verified Server instance, Owner and root as ordinary stills.
- Same PhotoKit authorization, original bytes, iCloud opt-in (off), protected
  private temporary file staging and cleanup.
- The encrypted per-resource journal uses role `video`, raw localIdentifier
  never persisted, stable HMAC destination tag, full SHA-256 and source stamp
  checks before writes; user-edited original changes its fingerprint.
- Reuses the existing journaled session: persist possible POST before create,
  persist UUID before any chunk PUT, mark possible finalize before POST, and
  require the current Owner Node's full hash/revision receipt.
- 8-MiB native UploadSession chunks, one media resource at a time;
  max 1 GiB per video and 128 MiB per still, max 20 *new originals* per
  explicitly triggered foreground run, max 256 scanned candidates/window.
- Live Photos continue to be skipped, not partially emitted as stills.
  A separate *single authoritative bundle/paired receipt* must land before
  Live may be marked complete.

The shared UI/Host adapter must be updated to expose truthful video counts
before declaring video backup MVP released. The engine now carries
`videoUploaded` and `videoVerifiedAlready` for that follow-up. A large
4K video over the cap remains unavailable and is never replaced with its
thumbnail or a transcoded proxy.

iPhoneOS compilation, real HEVC/HDR video, iCloud network fetch, 1GiB
storage/duration, actual cancel/crash/ACK cut and physical SideStore install:
**跳过（未验收）**. The isolated pure Swift policy check was compiled and
executed on Linux with `swiftc -swift-version 5`, result PASS. The unsigned
IPA GitHub workflow also runs it on macOS before exact-HEAD Xcode build.
