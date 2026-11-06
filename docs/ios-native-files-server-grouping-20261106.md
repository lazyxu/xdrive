# iOS Native Files — Server-backed arrangement and grouping

Status: **integrated development work pending CI**, not merged. Supersedes the unstarted standalone grouping PR #3965; #3958's tested HEAD remains unchanged.

## Design

- Native Files offers grouping by **type**, **modified month** and **size**, plus the existing name/date/size/type sort and folders-first toggle.
- Both native list and grid ask the existing Go `/api/v1/nodes/:id/children` counted endpoint for `group` and `folders_first`. Go orders returned Nodes and reports `groups: [{key,item_count,start_index}]` on the first counted offset=0 page.
- The group list is **authoritative for the entire directory**, never recalculated from 64–256 mounted rows. Native segments only those bounded rows that intersect the given global group index. It never materializes 10k/100k directory contents or guesses a group from a file extension.
- When returning to a saved nonzero page offset, query only offset=0, limit=1 once to validate the Server's whole-directory group indexes, then retain the actual selected 64-item window. If the global count changes mid-read, reject the combination.
- Grouping, folders-first, Owner, Source directory, sort and search filters are all part of the page's scoped identity and revalidation. Changing arrangement resets the old range; Owner change clears all groups. Searches continue to use the existing ungrouped Server search (never fake client grouping).

## Automated regression matrix

- Pure Swift: group key names, byte ranges, duplicate/gapped/overlapping/missing indexes, count reconciliation, JSON decode, and window intersection.
- Source tests: exact Go parameters and global index contract, grouped List+Grid, unchanged row navigation, swipe/menu selection and data ownership; old tests updated to follow a single extracted row action helper rather than assuming a direct ForEach layout.
- Required real Xcode Native IPA, exact-HEAD CI and Final Gate must pass before merging. Device-level acceptance (100k pages, Dynamic Type, VoiceOver and tap-return flicker comparison): **跳过（未验收）**.

## Related work consolidated alongside grouping

In-place folder disclosure, generic operation undo/redo, Browse home organisation and real iPhone UI/performance measurements. No second Server API or WebView is introduced.
