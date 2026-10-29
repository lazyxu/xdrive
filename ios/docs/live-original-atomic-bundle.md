# iOS Live Photo complete-original backup: single Owner ZIP Node

The first practical Live Photo original backup stores **both** of Apple's
independently authorized PhotoKit resources inside a single standard ZIP
(`STORE` compression mode, no transcoding). That ZIP is the **only** file
submitted through xDrive's existing encrypted journal + Go UploadSession
+ CAS/Node SHA256/revision path. A completed ZIP is therefore a single
physical Owner Node receipt. It is not two unrelated successful files that
the UI could mistake for a complete Live asset.

The archive includes `media/still.<original extension>`,
`media/motion.<original extension>` and `manifest.json`. The manifest
records each original role, original filename, byte size and ZIP CRC32.
Only sanitized deterministic archive paths are used; raw PhotoKit local
identifiers never enter file names, manifest, Server API or journal.
Both inputs are read twice to ensure the exact size and CRC32 are stable
while writing; the ZIP central directory appears only after **both** complete.
The uploader separately calculates the whole ZIP SHA256 and verifies the
current Owner Node's full hash and revision after Server CAS finalize.

- PhotoKit Full/Limited authorization, Server Owner/root and resource stamp
  must remain unchanged before the pair is accepted.
- Both original still and paired motion must be available. An iCloud-only
  original is fetched solely with the user's explicit iCloud option.
- Each input <=512 MiB, combined <=1 GiB; one pair at a time, no
  large array holding the originals in RAM.
- The encrypted journal adds a distinct `liveBundle` role. A crashed
  create/finalize ACK remains unknown, not auto-retried.
- Temporary protected resource files and the archive live in the same
  private staging directory and are removed by the foreground owner after
  completion, interruption, or error.
- The same 256-scanned / 20-new-items-per-run limits apply. The report
  distinguishes **Live ZIP bundles uploaded/verified** from unbacked Live
  resources and from plain video originals.

**Important limitation:** This is a faithful *original-asset archive*, not
yet an xDrive Gallery-native Live Photo pair. Files can download/extract the
ZIP to recover both originals. Gallery Live display and a Server PhotoAsset
resource graph/metadata association must be implemented separately; do not
label it as playable/restorable iOS Live Photo automatically.

macOS unsigned IPA CI now runs a standard `unzip` test that checks the real
stored still/motion bytes, manifest and bad/missing resource refusal.
Real iPhone original pair, edited Live resources, slow iCloud, >512 MiB motion,
video codec, PhotoKit access revocation, background transfer and SideStore:
**跳过（未验收）**.
