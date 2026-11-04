# iOS Photos native managed backup destination — stage 1

Decision: **a destination is mandatory**, configured with **one folder name**.
The text input is initially prefilled from the current iPhone's device name
(or "iPhone" when invalid). The name is a leaf only, not a path. The
Server constructs and owns the final destination:

```
同步文件夹 / 设备备份 / <server-verified device name>_<stable device-id prefix> / <user-entered folder name>
```

Contract introduced by this scoped, stacked development PR:

- Authenticated `GET /api/v1/ios/photos/backup-destination`: requires current
  Owner **and** registered iOS identity proof headers; returns
  `configured=false` and `suggested_name` or verified
  `{source_id,device_id,name,target_node_id,target_path}`.
- Authenticated `PUT /api/v1/ios/photos/backup-destination` with
  `{"name":"..."}`: creates a **paused**, managed `ios_photos` Push
  Source and exact exclusive Node **in one transaction**; retries with the
  same name are idempotent. Another name performs a 5B atomic Source+real
  Node rename; no user-chosen `parent_id`/`target_node_id` is accepted.
- Identity-only iOS credentials are accepted on this *one* dedicated endpoint,
  not by `POST /sources` or Desktop local-folder Agent/Root APIs.
- The already existing Local Push device-group policy provides UUID-disambiguated
  names and rejects unverified folder takeover, overlapping Source trees, and
  mixed-provenance device group adoption.
- All old Owner-root photo files and encrypted upload receipts remain intact.
  This stage does **not** silently reparent, delete or declare them transferred.

**Explicitly NOT completed by stage 1:** The iOS UI consent/control wiring,
mandatory gating of *all* manual/automatic/BG photo uploads, scoped managed
UploadSession create/finalize/receipt admission, changeover of old sealed
Owner-root journal records, or iPhone hardware acceptance. A managed Node
rejects generic Files uploads, so **never** substitute this new NodeID into
the existing iOS uploader before the dedicated Go upload authorization and
both foreground/background receipt verifiers are integrated.

Parent: #3757. This branch is stacked on its development HEAD (not merged
into master). The parent retains its own CI; no running/green PR HEAD changed.

Acceptance for the next P0 delivery:
1. Explicit device registration, Owner proof and destination name before
   enabling auto/focused/manual/background plans; stale Owner must fail closed.
2. One verified target ID persisted under the current Owner+registered Device;
   no raw target path built locally, no silent Owner-root fallback.
3. Scoped original UploadSession creates/PUTs/finalizes and receipt review
   admitted only for that exact managed Source+Node, including BG grant;
   unknown ACK remains pending with no blind retry.
4. New originals go only to the managed destination; legacy root receipts
   retain their old parent and remain readable/reconcilable.
5. Real iPhone, large-video/Live/iCloud, logout/revoke, duplicate folder name,
   and matching Node-identity acceptance before claiming product MVP.
