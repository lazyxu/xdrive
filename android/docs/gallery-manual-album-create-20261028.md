# Android 手动相册创建 · iOS PWA Collections MVP · 2026-10-28

## Scope

The native Android Collections view reads the existing Go Owner PhotoCollections.
This increment adds a real **新建** manual-album flow without a WebView, a second
album database, a media upload, or an Android-specific writer.

The only write is the existing authenticated
POST /api/v1/media/albums with body {"name": "..."}.
The Go Server remains authoritative for Owner, name validation, newly generated
manual:* identity, revision, membership and the persistent collection record.

## Failure/uncertain ACK semantics

- Validate trimmed 1–200 Unicode scalar names, reject control characters and
  malformed UTF-16, then allow Go normalizeMediaAlbumName to remain authoritative.
- Use authenticatedMutation for **one** POST, without a token-refresh or retry
  replay. A successful response must describe an empty manual album with matching
  name, valid Owner-shaped manual:* identity, revision 1, folder 0 and no cover.
- If a POST fails or returns a bad ACK, freeze creation and display **结果未确认**.
  Only an explicit read-only GET /media/albums reconciles the Owner collection
  snapshot and releases the mutation gate. No optimistic fake album card.
- If POST succeeds and the subsequent GET fails or omits the created album,
  display **相册已创建，列表刷新失败** and retry GET only; never resend POST.
- Collection page navigation cannot preempt an uncertain POST. Session logout,
  password-required transitions and Owner changes clear all private state.
- Once the verified GET returns the actual collection, display its real card,
  matching PWA's Collections model. Other collection types remain read-only.
- Real original media bytes and CAS are unaffected.

## Tests and acceptance

Core MockWebServer verifies POST, Bearer, name JSON, 201 parsing, bogus identity
response, 503 and zero local retries. Controller JVM covers single POST with
subsequent Owner GET, uncertain ACK freeze/GET-only recovery, and committed
POST followed by a failed GET. API35 Compose fixture exercises the actual
Collections empty view, new-album dialog, confirmation, and real returned card.

The candidate must pass the exact-HEAD Android Unit/Lint/APK/API35 and required
Final Gate checks. Production Owner account, physical OEM device and iOS
side-by-side screenshot comparisons are **跳过（未验收）**, not CI successes.
