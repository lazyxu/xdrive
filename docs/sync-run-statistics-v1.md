# Synchronization run accounting and detail snapshots (v1)

Scope: shared Sync Folder history for Web, Mobile Web and Desktop (Server → Go Client → Agent IPC → shared MUI). Aggregates are not a partition inferred from scanned and failed totals.

| Metric | Truth source |
|---|---|
| Scanned | Connector-discovered observations; never equivalent to successful upload. |
| Ignored / Unchanged | Scan-plan ignore and no-content-change decisions. |
| Skipped | Connector summary of ignored + unchanged. Run detail captures observed path, external ID, size, reason and timestamp. |
| Synced | Server-confirmed, idempotently committed file + directory mappings. Scan-only jobs have no new commits. |
| Failed | Explicit per-item errors and unresolved pending items when a completed/partial run is finalized. |
| Discovered unfinished | Exact count of pending items that were observed in this cancelled sync run. Does not include never-scanned remote inventory. Scan-only and old run values are unknown. |
| Discovered move / confirmed move | Plan action versus a completed move or move+update source commit. |
| CAS reused | Existing CAS-staged chunks verified at successful finalize, or the explicitly marked owner-authorized instant-CAS upload. |
| Resume reused | Validated chunks from a previous incomplete upload session, not already CAS-marked. |
| Network bytes saved | Only confirmed CAS + resume reused bytes for durably committed files. Excludes speculative scan estimates. |
| Transferred bytes | Data bytes accepted by successful chunk upload operations for committed results. Network retries and failed/uncommitted attempts are not included: **not** a packet-level wire meter. |

Historical readback: new runs set stats_version=1; old runs retain stats_version=0 and must not display new 0-default confirmed reuse/move counters as measured zero. xd_source_run_skips keeps immutable observed skip rows keyed by (run_id, external_id); source items ignored on the first observation are intentionally not created in xd_source_items. xd_source_run_failures saves immutable error, owner-scoped path and a category: network, permission, rate_limit, conflict, file_changed or other. Pull and supported Push executors report categorized errors before finalization. Typed transport errors are preferred; legacy text classification is conservative and may return other. Details are paginated and use the existing 180-day failure-history retention; aggregate run rows remain after per-item details expire.

Security and correctness: read endpoints check source ownership and apply the same Local Folder Push detail-read restrictions as failure history; planner skips and repeated commit requests do not count successful writes. CAS and resume attribution is possible only with server-verifiable returned part reuse flags or an explicit instant-CAS finalized marker. When metrics are unavailable on old records, the UI displays unknown, never 0-as-fact or scanned-minus-failed.

Verification: PostgreSQL source-run integration tests cover immutable skip snapshots and retries, idempotent moved and reused counters, and cancellation pending counts. Retention integration tests cover skips and failures. Pure Go tests cover classification and upload reuse, and shared Node/TS tests cover label semantics and Web/Desktop transport parity. Required Go Linux/Windows, Web and Desktop CI gates must run on the exact PR commit before merging.
