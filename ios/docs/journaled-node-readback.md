# Native iOS journaled UploadSession: authenticated Node readback

This is an **additional fail-closed read-only integrity step** after the
existing Go UploadSession reports `finalized`. It does not create a
second uploader, alter CAS, create a PhotoAsset or grant local Device/Root
permissions.

For the current native, Server-verified Owner/Root and the same
memory-only access Bearer:

1. `IOSJournaledOriginalUpload` obtains the existing, checksum-checked
   UploadSession final file receipt.
2. `IOSNodeReceiptReadbackVerifier` re-queries `GET /api/v1/me` and
   `GET /api/v1/nodes/root` through the existing Owner verifier and
   rejects a changed installation, numeric Owner or root.
3. It fetches `GET /api/v1/nodes/{id}` through standard HTTPS trust,
   with no ambient Cookie, cross-origin redirect, persisted Bearer or
   session replay.
4. The current Owner's actual nondeleted file Node must have the same
   ID, destination parent, exact filename, `type=file`, byte count,
   revision and full SHA-256 as the finalized UploadSession receipt.
   Missing fields, stale revision, altered file, expired Bearer or
   network failure all fail closed.
5. Only then is the encrypted journal transitioned to `confirmed`.
   If the readback fails after a physical finalize, the journal retains
   `needsReconciliation`; it must not blindly create another upload.

The readback validates authoritative Server metadata and access, not
raw CAS bytes on disk. A later physical integrity verifier and
PhotoAsset/PhotoResource pairing proof are distinct requirements.

The existing user-selected **manual** file/photo upload path is
unchanged; this verification only applies to the journal-backed
future photo runner. Current automatic scheduling remains disabled
pending iOS photo-only Device/Root authorization and restart recovery.

Required: exact HEAD iOS unsigned IPA compile and source security
review. Real iPhone, PG17/CAS physical readback, Server ACL revocation,
network disconnect after finalize and second incremental pass remain
**跳过（未验收）** until demonstrated. Do not weaken CI assertions.
