# Native iOS WKWebView downloads for canonical PWA Files

The native iOS app intentionally renders the Server-hosted canonical
React/MUI PWA UI in a persistent `WKWebView` and keeps its HttpOnly browser
Cookie independent from the native diagnostic login Keychain.

The existing PWA Files downloader can create a same-origin
`blob:https://<server>/...` URL and click an `<a download>` link. Without
native WebKit download plumbing, the previous origin-locked navigation
delegate cancelled that Blob URL as a non-HTTPS top-level navigation:
normal PWA saving might never reach iOS's Files export sheet.

## New behavior

- A WebKit navigation with `shouldPerformDownload` is sent to
  WKDownload only if the URL is on the currently selected **HTTPS origin**
  or a `blob:` URL whose embedded origin is exactly that HTTPS origin.
  Ordinary cross-origin links still open Safari explicitly, not download.
- Unrenderable same-origin HTTP responses may also become a
  `WKDownload`. Native WebKit's existing browser Cookie/auth connection
  is reused; neither native refresh nor access tokens are injected into
  JavaScript, URL query parameters, files or a second HTTP client.
- A dedicated `WKDownloadDelegate` checks the source again, refuses
  cross-origin redirects and limits simultaneous downloads to **2**.
  It creates a random, app-private `0700` temp directory, requests the
  system write to a nonexistent sanitized filename under iOS complete file
  protection, and then presents the standard iOS share/save-to-Files
  sheet on confirmed finish.
- A failed, cancelled, dismissed or server-switched download is never
  shown as saved. The temporary private download is removed on failure,
  share-sheet completion and navigation teardown. The user still chooses
  a persistent destination.
- The Web/PWA page and navigation remain canonical; no duplicate native
  Files page, Owner JWT, Cloud Pull, file bytes cache or new Server API
  is introduced. Existing isolated HTTPS map iframe navigation is
  preserved.

## Scope limits

The system file picker/export sheet is Apple-owned and is not proof of
a persistent saved file until the user completes it. WebKit download
progress may be of unknown length, so this patch never displays
fabricated speeds, bytes or completion percentages. It does not
automatically restart failed downloads, keep them running after host
switch, or claim a background download service. It does not bypass
iOS system TLS validation or grant a foreign Blob origin.

iOS 16+ WKDownload and WKDownloadDelegate are used directly; they do
not require app developer certificates or extra PWA server endpoints.
The exact iOS IPA Xcode build, PWA blob click, large ZIP, FileProvider
and real-device saving/cancel/low-storage tests should be checked
independently. Unavailable physical iPhone and production acceptance
remain **跳过（未验收）**.
