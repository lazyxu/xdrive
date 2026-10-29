# Native PhotoKit original → sealed Owner/Device intent (no upload)

The merged iOS PhotoKit exporter yields private local resource bytes only after
explicit access. The existing journaled uploader requires an exact, durable
operation HMAC, destination, original byte size and full SHA-256 before it
can submit any Server request.

This increment bridges those two internal layers for **one ordinary,
non-Live still image**.

## One bounded preparation

`XDriveIOSPhotoKitStagedIntentPreparer.prepareStill` receives a currently
selected transient PhotoKit localIdentifier, an already staged
`XDriveStagedPhotoKitAsset`, a trusted native Owner/Root and encrypted
`XDrivePhotoSyncScope` from an eventual authenticated iOS Device/Root
enrollment. It must not be called from a general background scan before
photo-only Device authorization is implemented.

1. Validate canonical HTTPS Server origin, persistent installation ID,
   current numeric Owner and root and UUID-shaped Device ID. **A UUID is
   only syntactic validation, not proof of Device registration.**
2. Refuse video, Live, missing resource, invalid filename, excessive
   original size (>1 GiB), unexpected role, outside staging path or
   non-regular file. This primitive never uploads a Live still alone.
3. Re-read `GET /api/v1/me` and `GET /api/v1/nodes/root` under the
   in-memory native Bearer to re-check Owner identity.
4. Read the currently authorized PhotoKit original-resource manifest and
   basic source stamp (creation/modification date and pixels).
5. Hash the private staged original with CryptoKit SHA-256 in **8 MiB**
   bounded chunks, verifying the claimed byte size and final disk length
   without buffering 1 GiB in memory.
6. Revalidate PhotoKit Full/Limited permission, asset visibility, still
   resource filename and source stamp. A revoked/changed photo fails
   before the journal is modified.
7. Call the existing actor's `ledger.prepare`, which HMAC-fingerprints
   the transient localIdentifier and exact resource identity and persists
   an opaque stable resume key. This is a **prepared intent only**,
   never a completed or executing backup.

The raw PhotoKit local identifier, photo GPS and original bytes are not
persisted in the journal, logs, native login or Web/PWA session. No
additional Server API, upload writer, staging copy or Keychain secret is
created; the caller continues to own deletion of the temporary original.

## Not yet a native photo backup Runner

- The current Server `/devices/self` enrollment is identity-only and
  does not authorize an iOS Photos Source/Root. A future secure binding
  must prove the exact Device and photo-only source rights before this
  function is exposed as an automatic queue trigger.
- The candidate's PhotoKit source stamp is **not a durable revision
  attestation**. Before actual network side effects, the Runner must
  re-check the exact authorized source, its real exported file hash,
  current Owner/Device/Root and frozen work generation.
- The 1024-entry sealed journal is currently a **bounded prototype**;
  100k incremental full-library backups require a reviewed sharded
  per-resource manifest and confirmed-receipt lookup before enabling
  automatic enrollment. Do not evict confirmed records and resend
  whole albums as a workaround.
- Live Photo must have the still+motion original **and one
  authoritative paired Server PhotoAsset receipt**. Per-file
  UploadSession success alone is insufficient.
- Real iPhone/iCloud original, Modified/Deleted Photos, power loss and
  end-to-end first/second scan tests are **跳过（未验收）** until observed.

This PR contains only one new Swift preparer plus this document. It
does not touch pending iOS Device identity or Server recovery PRs, and
it does not change the existing manual Files/Photos upload UX.
