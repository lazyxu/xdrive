# Android Files Owner arrangement · source-exact first increment (2026-10-28)

Native Compose Files now exposes four real Server sorts: name, modified date,
type, size, with ascending/descending and folder-first on/off. It uses the
existing authenticated Go `/nodes/:id/children?offset&limit=100&sort&order&group=none&folders_first`
and `/children/position` contracts, not local sorting of only loaded items.

## Atomic UI and paging semantics

- One session-scoped `FileBrowseArrangement` controls Browse queries, next/
  previous 100-item pages, first-page refresh after mutation, and Owner-checked
  Show in Folder absolute position.
- New arrangement becomes visible only after an exact first authenticated
  Range succeeds. A failed/late GET keeps the original arrangement, rows and
  viewport. A new navigation cancels obsolete GET through the same generation.
- Changing the arrangement resets the virtual-list position before first paint,
  avoiding a stale item-50 index against a different Node. Existing session
  directory anchors do not cross arrangement changes.
- In-flight writes, ambiguous batch DELETE, SAF upload/download, destination
  chooser or active selection are not interrupted by sort changes. A lost
  mutation ACK is resolved by GET-only reconciliation.
- The native UI shows *排序* and does not display a fake 分组 option. Full
  grouping (Go `groups` index, group-header virtualization and date bins) is
  a separate follow-up; it must not be implemented as a partial local grouping.

## Validation

Core MockWebServer verifies Owner Bearer, sort/order/folders-first parameters,
Server ordering ACK and position matching, plus fail-closed malformed responses.
Controller JVM verifies atomic sort commit, failed GET, retry without resetting
the old order, exact 155th item location with one offset-100 page, and selection.
API35 Compose exercises the real four-choice sorting dialog and response.

Accurate-HEAD Android JVM/Core, lint, Debug APK, API35 Compose and actual GitHub
required checks are mandatory before merger. Physical Android OEM, production
Owner/CA and iOS screenshot comparison remain **跳过（未验收）**.
