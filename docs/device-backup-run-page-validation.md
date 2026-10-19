# P0-C1d — owner-redacted Device Backup history-page runtime gate

## Scope

The shared Web, Mobile Web and Desktop Device Backup viewer previously accepted the statically typed response to `source.runs()` directly into React history state. A buggy older Agent, malformed transport payload or stale cross-source response could present the wrong Source's history as authoritative or turn an invalid page into a verified empty page.

The new pure runtime validator runs **after** the request-generation check and **before** the history state commit. It rejects incorrect Source IDs, malformed/oversized pages, duplicated or wrongly ordered run rows, inconsistent `has_more`, non-finite/negative counters, bad date fields, malformed identifiers and unexpected run keys such as raw errors or local paths. It checks Server's descending start-time ordering **within** each page and the same 1–100 item page bound used by the server. It does not invent a stable snapshot across offset pages during concurrent writes.

On validation failure, the existing catch path leaves prior verified rows and committed page number in place, shows the existing retry message, and does not set `verified=true` on the rejected page. The existing account/server datasource guard and per-Source request-generation fence are preserved. Web/Mobile Web and Desktop use the same validator and Server owner-redacted allowlist; no new read or mutation API is added.

## Evidence and boundaries

- Isolated TypeScript strict check and Node tests exercise a 20+2 page, zero-length valid final page, wrong owner-bound Source ID, duplicate/out-of-order Run, false continuation, malformed counters/dates/ID and unwanted local path/error fields.
- The mounted shared-component source contract checks that runtime validation precedes React history state insertion; repository CI is authoritative for Web, Desktop and existing tests.
- No browser/network end-to-end evidence, physical Windows/Linux 100k or >=4GiB upload, Server SQL/CAS mutation, Agent IPC, local Root/credential, SourceRun activation, Runner, cancellation, scheduled watch, NAS Push or Mirror deletion is claimed.
