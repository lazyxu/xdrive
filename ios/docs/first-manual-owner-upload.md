# iOS first manual Owner-upload flow (not native Photos backup)

This increment closes one small, real, inspectable path from the native iOS
diagnostic login to the existing xDrive Go UploadSession:

1. Sign in on the **native diagnostic login card** (separate from the
   server-hosted PWA Cookie session).
2. Tap **验证 Owner 与云端根目录（只读）**. This reuses the current native
   access Bearer, strict HTTPS, `GET /me` installation/Owner identity and
   `GET /nodes/root` to establish the exact Owner root.
3. Tap **手动上传单个文件（不超过 128 MiB）** and pick one file from the
   iOS Files provider; this is an explicit user action, NOT an implicit
   system-Photos synchronization permission.
4. Copy the selected resource to an app-private 0700 protected directory with
   a random filename, after acquiring the system security scope. Reject
   unreadable, non-regular, over-128-MiB, or invalidly named entries. The
   user's original Files provider item is never changed.
5. Recheck that the SAME authenticated Server installation, Owner and root
   still exist. Then use the existing native transport's SHA256/8-MiB
   UploadSession/chunk/finalize and exact trusted Server receipt.
6. Only after an authenticated, matching Server Node/revision receipt show
   **Server 已确认保存**. A stale session, failed/cancelled request, denied
   provider read or unknown finalize ACK must not be reported as success.
7. Always remove staged original bytes after the request ends; on exit from
   the native dialog cancel the in-memory transfer. There is no second CAS
   writer, and no direct PhotoAsset mutation.

## Known limitations (honest UI)

- This is a **foreground, selected-document** upload: no PhotoKit original
  export, Live Photo still/motion pairing, auto-sync, durable queue, calendar
  schedule, background URLSession or cloud-pull.
- The native login refresh credential and Web/PWA HttpOnly Cookie are separate.
  The upload requires a current short-lived native Access Token; after expiry
  the user may need to restore native login before a new request.
- A create POST may have reached the Server even when HTTP acknowledgment is
  lost. This isolated manual path does not yet integrate the new encrypted
  Owner/Device intent ledger. On an uncertain result it warns to inspect the
  root before any repeat attempt. The Server's 24h staging lifecycle remains
  the fallback; this is **not** exact-once crash-recoverable backup.
- The app never registers an iOS Device as `darwin`. The existing
  `/api/v1/devices` registration currently only allows desktop Agent
  platforms; a limited native-iOS Device protocol needs its own authenticated
  capability and safety tests before enabling automatic Push.
- The 128-MiB cap bounds file-provider staging; use the existing PWA
  uploader for large files until a durable native runner exists.
- iPhone SideStore/Files-provider/iCloud and exact Go Owner upload E2E are
  **跳过（未验收）** until physically performed, and must not block unrelated
  source-level merge policies.

A complete photo backup must additionally prove the registered Device/Root,
durable pre-POST resume identity, authoritative PhotoAsset/PhotoResource
pairing and a verified second incremental scan without duplicate writes.
