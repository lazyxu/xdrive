# SH-P022 · Go-issued Share capability grants — metadata + frontend enforcement

> **当前统一架构合同（2026-10-22）：** [Owner/Share 共用 FileExplorer Core](unified-file-explorer-core.md)。它列明已合并的 Core/七项 Go grant、Owner 稀疏 Range/Share 游标页、临时 HTTP 与 durable Task 取消边界，以及仍未完成的 Share 单文件外层、全子树 Search/Sort 与真正 preview-only。以下原有段落保留历史阶段证据，不应当作新的当前状态。

## Contract

The single FileExplorer Core has separate transport adapters: account JWT/ACL
with Owner API, and Share token/password with Share-root-scoped API. A single
`readOnly=true` flag cannot safely represent access. The Go endpoint
`GET /api/v1/public/share` now publishes the additive JSON property
`capabilities`, with the seven explicit fields:

| Field | File share | Folder share | Server authority |
| --- | --- | --- | --- |
| list | true | true | Share token, root / root-relative child validation, expiry/revocation |
| preview | true | true | Existing signed preview / thumbnail endpoints still reauthorize |
| download | true | true | Existing signed original/download ticket endpoint still reauthorizes |
| downloadZip | false | true | Existing server ZIP prepare/status/ticket authorization |
| search | false | false | No full-subtree Share search API exists |
| write | false | false | No anonymous mutation permission |
| delete | false | false | No anonymous mutation permission |

These grants are an **upper bound** for UI actions, not proof of a valid
password, non-exhausted download limit or a license to skip an endpoint check.
Go still verifies share status, owner existence/disabled state, node ownership,
password (where required), revision/expiry, bounded Share subtree and quota
on the relevant endpoint. The new metadata response remains `no-store`.
No account JWT token is inserted into Share requests; no Share bearer reaches
Owner API.

Clients on an older Go Server without the additive property retain the
**previous, proven default read-only** list/preview/original/ZIP behavior:
never infer the newer unsupported search/write/delete grants.
The Web wrapper resolves list, preview, download, downloadZip independently.
A disabled download cannot block browse/preview or stop in-progress native
download; a disabled list grant suppresses initial auto-open.

## Security limitation: preview-only not released

This phase **does not** add per-link configurable grants or secure
`preview=true/download=false` links. The endpoint currently returns the
same fixed read-only set for every authorized link, except folder ZIP. A
frontend test that narrows a hypothetical download grant only demonstrates
renderer affordances and is **not** a server-side no-original guarantee.
Before any preview-only link can ship, Go must store the grant on the Share
record and enforce it on every original signed ticket, original Range,
download, archive prepare/status and streaming path, with expiry/revoke/
password and Owner negative tests.

## Source-exact acceptance

New opt-in workflow:
`.github/workflows/sh-p022-public-grants-api-100k-contract.yml`.
Runs actual PostgreSQL17/Gin/LocalCAS `TestDownloadShareLifecycle` plus
new seven-grant Go tests; typed production `web build`; actual React
PublicShare form tests and shared-FileExplorer capability/adapter contracts.
No benchmark threshold, 100k physical corpus, Go throughput or CAS bytes
changed by this capability-field addition.

Previous **matched**, source-exact 100k JPEG P018 Go Context cancel n9/arm:
Web1440 median 127.940→55.371ms (-56.7%), CDP390
113.940→49.701ms (-56.4%), no abandoned bytes (CI #39610524239).
Owner/Share 100k physical Grid/Details and 4GiB Web/Desktop transfers remain
independent regression baselines. This commit is **functional**: new
same-Runner A/B throughput gain N/A. Do not claim a performance improvement
or completed full single Explorer convergence from service grants alone.

## Dependencies

#2275 P018 request cancellation -> #2290 P020 shared seven-grant
contract -> #2307 P021 actual shared Grid/Details shell -> this P022 server
metadata. Dependencies are Draft; preserve all source-exact CI/Final Gate
and merge/rebase order, avoid touching Race. Production-specific inaccessible
security acceptance: **按用户决定跳过（未验收）**, whereas code-level auth and
CI tests remain mandatory.

## 2026-10-22 · SH-P021 dependency merged; P022 restacked without duplicating Core

Common Owner/Share FileExplorer Core SH-P021 [#2307](https://github.com/lazyxu/xdrive/pull/2307) **MERGED** to master commit `3de4deb7f9e6b3c27a88c9fda19670570b584943` after [77+ CI #39701602886](https://github.com/lazyxu/xdrive/actions/runs/39701602886), [true physical 100k six-session #39701601239](https://github.com/lazyxu/xdrive/actions/runs/39701601239), and [real Go-cancel six-session #39701601601](https://github.com/lazyxu/xdrive/actions/runs/39701601601) all SUCCESS. Shared source-only Share grants specialty on original P022 HEAD `6f222af0757eba7263ff57e21edd8cdc8e5f5442` [#39701704116](https://github.com/lazyxu/xdrive/actions/runs/39701704116) also SUCCESS.

This P022 branch now directly targets **complete master** with precisely one additive work commit and its original **nine scope files only**; no copy of the merged SH-P021 commit, unrelated PWA/Push/Host, or original AGENTS history is overwritten. Original P022 green is historical evidence; new exact HEAD must independently pass complete Web/Desktop/Go Linux/Windows/API PostgreSQL/Final Gate, Share root/expired/revoked/password/download quota negatives, and dedicated opt-in source grant test before Ready/squash merge.

This change supplies seven explicit **server-issued metadata ceilings** and existing Go Share per-route checks. It still does **not** persist per-link configurable preview-only policies or revoke signed original/ZIP/Range access based solely on a UI button; secure preview-only remains NOT IMPLEMENTED, and browser preview bytes cannot be guaranteed unsaveable. Short-lived HTTP AbortSignal must not cancel already durable ZIP/download/upload/SyncRun/delete tasks. Performance AFTER N/A: no Go SQL, CAS worker, or 100k throughput optimization.
