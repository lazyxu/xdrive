# Mobile Files: search return and explicit presentation

Status: Implementation, independent review and final local gates complete; PR delivery remains the final gate. Approved ordered scope M04 then M05, following M01–M03 in PR #1092. The original immediate dependency was `09bf8bdeb06382573ed03d17a680e2d43890c321`. After #1092 landed, only this work's single commit was reconstructed without conflicts onto `daf35bced5f8ebb56055572c27e9ac52005f19d8`.

## Contract

Search uses the existing owner-wide Server collection. Show its real scope, committed query, readable filters and authoritative count; clearing search and collapsing its input are different actions. Search results use the existing opener and authoritative crumbs for “显示所在文件夹”. Internal Back/Forward restores the search definition, order, selection and bounded logical viewport. App-level Viewer return retains its mounted caller.

Keep runtime search/history identities and return snapshots in memory only. Public persisted navigation remains version 1, folder-only. Preserve generation checks, sparse range loading, bounded retention and Web/Desktop parity. Missing or changed items never transfer selection to another item at the same ordinal.

Sort fields preserve direction; direction has explicit choices. Show grouping, folders-first and effective view. Unsupported Columns presentation falls back to List without rewriting the saved preference. Explicit List/Grid choices remain persistent.

## Tasks and ownership

- [x] Reproduce search/history failures with composed real-controller tests, then implement history-entry identity, keyed search restoration, pruning and authoritative containing-folder navigation. Controller agent owns Navigation, Search, WorkspaceController, the pure controller helper, and its focused tests.
- [x] Extract readable filter summaries and add optional containing-folder menu action; keep existing filter semantics and native Desktop reveal separate. Presentation agent owns SearchFilters, FileExplorerActions, and focused tests.
- [x] Parent integrates the shared FileExplorer view-state bridge, search summary/clear, explicit sort/view UI and both platform adapters.
- [x] Browser agent supplies real-component regressions for deep return, partial loading, current conditions, native focus, sort and responsive view projection.
- [x] Reconcile canonical contracts and M04/M05 evidence; run focused browser and controller suites, typecheck, Web lint/build and materially related regressions. Final shared browser 104/174/54, actual Web 48 and full App 901 pass; Desktop 1,327 pass/0 fail/1 existing skip. The concrete compact status/navigation overlap has the same first-red → green geometry assertion.
- [ ] Independent review, one-commit PR CI, linear merge and cleanup. Native device claims remain governed by the M49 matrix.

## Validation boundary

Exact viewport restoration is guaranteed for an unchanged collection. Existing Server APIs cannot locate an arbitrary stable ID's new ordinal after unrelated namespace mutations; revisit only the saved bounded window, retain valid identities and expose the actual fallback. Never enumerate all results to manufacture exact positioning.
