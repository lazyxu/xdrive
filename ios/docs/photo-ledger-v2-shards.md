# iOS PhotoKit sealed journal V2: bounded sharded operations

This V2 journal has been incorporated into the canonical iOS background-original
upload integration (#3210), along with exact-ID encrypted shard lookup for
bounded upload and failure handling. It retains the **same Owner / Server instance / Root / local Device scope**, existing
Keychain AES-GCM key, HMAC fingerprint/resume key and all existing Go UploadSession /
Node SHA+revision receipts.

## Non-destructive upgrade

- A V1 scope uses one `ledger-<scope SHA>.bin` under
  `Application Support/xdrive-native-photo-ledgers-v1`. The old file remains
  **untouched** by every *new* V2 `prepare`. A prior V1 fingerprint wins,
  including `creating`, `uploading`, `finalizing`,
  `needsReconciliation` and `confirmed` states.
- Existing V1 operations continue to transition **in V1**, with the original
  AES-GCM associated data and `WhenUnlockedThisDeviceOnly` Keychain key.
  There is no automatic deletion, bulk migration or fake success.
- New operations go to `ledger-<scope SHA>-shard-<3 HMAC hex>.bin`, with
  V2 envelope version and independent authenticated AAD comprising the
  canonical Owner scope and shard. The UUID string retains UUID syntax and
  encodes the shard prefix for O(1) update routing, without any plaintext
  PhotoKit localIdentifier.
- On a repeat scan, the exact keyed fingerprint checks the legacy journal
  first and the selected V2 shard second. Repeated originals preserve the
  old upload resume state; unknown acknowledgments do **not** retry blindly.
- Each shard has its own 1024-operation bound / 4 MiB ciphertext envelope and
  atomically written `FileProtection.complete` file. 4096 HMAC-distributed
  shards support 100k synthetic independent resources without depending on
  the legacy single-file 1024 bound. Distribution is cryptographically uniform
  under the random Keychain HMAC key, not a deterministic capacity guarantee.
- A per-original upload or uncertain-ACK check reads the bounded V1 file
  and its selected authenticated V2 shard; it never loads all 4096 shards
  into memory on each transfer.
- A full read-only receipt inventory merges V1 and all present V2 files,
  rejects duplicate IDs/fingerprints, tampered or unreadable shards, wrong
  version/scope or changed authentication tags. It never substitutes empty
  records for corrupt media history.

## Boundaries and next steps

**This is journal capacity, not a claim of fully verified 100k iPhone backup.**
PhotoKit positional scan offsets can drift after edits/insertions, the full
read-only receipt inventory still builds an in-memory array, and physical
iPhone, lock-screen, long-video, iCloud and 100k first/second scan E2E remain
**跳过（未验收）**. A later PR should introduce stable generation-aware
PhotoKit scan checkpoints, bounded receipt enumeration and physical metrics.
No generic SourceRun, background bearer, native login UI or PDF/media editing
is added here.

The pure routing policy is manually executable wherever `swiftc` exists:

```sh
swiftc -swift-version 5 ios/XDriveIOS/PhotoLedgerShardPolicy.swift \
    ios/tests/PhotoLedgerShardPolicyChecks.swift -o /tmp/xdrive-photo-ledger-shards
/tmp/xdrive-photo-ledger-shards
```

The IPA workflow compiles/runs the pure Swift shard routing test and
compiles the complete app; it cannot substitute for iPhone crash replay.
The Desktop Node contract test also checks deterministic 100k synthetic
HMAC occupancy, preservation of legacy receipts, protected shard writes and
unknown-ACK fences. The exact-HEAD iOS IPA build is required to validate
Swift/CryptoKit/iOS integration before merging. Pure/source checks are not a
replacement for true Keychain file-system crash-and-replay testing.
