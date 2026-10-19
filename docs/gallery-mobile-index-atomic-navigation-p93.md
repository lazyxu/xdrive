# P93 · Mobile Gallery album/person index atomic navigation (2026-10-19)

## Source-confirmed residual

The shared Gallery already staged Mobile Collections -> Album/Person/Place, and compact Memories, Pets, Media Types and Places index transitions. Three gaps still eagerly mutated presentation while an authenticated first photo Range was pending:

- Compact `albums` index/album-folder organizer -> manual or smart album: `openAlbum(album, false)` reset the sparse virtual collection before a counted destination page.
- Compact `people` index -> identified person: `openPerson(person, false)` mutated section/query ahead of the confirmed Range.
- Compact `people` index -> suggested person: `openSuggestedPerson(person)` performed immediate presentation mutation.

All paths previously had a valid, visible index. The transient reset could produce a blank/shifted photo wall or a mismatched title even on a quick response.

## Change / acceptance

The original shared `ui/shared/src/mui/MediaGallery.tsx` now treats a compact index-card tap as *intent*, and passes a one-shot `onCommitted` callback to the existing `loadFirstPage` method. It keeps prior cards, title, scroll owner, virtual collection and filters until that exact current-owner/current-generation **counted first Range** is accepted and primed. A failing or superseded request never invokes that callback. All normal Server/Agent requests start immediately; real thumbnails/video posters/Live Photo, actual progress, error/retry and existing Viewer anchoring remain unchanged.

Existing Mobile Collections staging is retained. Wide Web/Desktop and already-open photo-detail navigation retain prior route semantics. No change to Server/API, Go cancellation, source background work, 100k benchmark logic or folder Column PR P92.

Regression: `desktop/tests/gallery-mobile-index-atomic-p93.cjs` mounts the *original* Album Organizer, executes production AST-extracted callbacks from the shared Gallery, holds a real mounted index >350ms, and tests failed, superseded, committed requests, Person/Suggested Person callbacks and original counted-Range commit placement. Full exact-head Web/Desktop/Go/Rootless/Windows/Linux/Final Gate CI and real built Chromium before/held/after frames should be checked before Ready or merge.

**Evidence limit:** no physical iOS Safari/Android/installed PWA, WAN/100k CLS/FPS, voice-reader, built-browser or CI results have been measured in this authoring session. Do not mark broad navigation or release acceptance complete from static or React-mounted tests alone.
