# P070 · FileExplorer background thumbnail transport cancellation (request-scoped)

## Frozen BEFORE

Source: complete master `95ac411a9cf10fdfa6650be669ab381e5d7b5d18`. The candidate preserves existing shared thumbnail queue concurrency 6, cache limit 96, scope isolation and all durable transfer controls. The accepted 100k FileExplorer Grid/Details scroll → Go Context.Done tests establish scroll cancellation, not background mounted-window cancellation.

## Candidate

On document `visibilitychange` to hidden or window `pagehide`, the already mounted shared FileExplorer thumbnail provider synchronously cancels *only currently pending or active ephemeral thumbnail* AbortControllers, causing actual outstanding HTTP requests to be aborted. On `visibilitychange` foreground or `pageshow`, eligible visible thumbnails may retry. Cache entries already resolved retain their URL/lease. Existing account-switch teardown, LRU, and scroll teardown remain.

## BEFORE/AFTER protocol

Workflow `.github/workflows/p070-file-explorer-background-abort.yml` compiles the **original** component via `git show 95ac411a9cf10fdfa6650be669ab381e5d7b5d18:ui/shared/src/mui/FileExplorerThumbnail.tsx` and the candidate component from this PR's exact HEAD, both exercised with the actual React hooks and real local HTTP fetch/AbortSignal on the SAME runner. Three alternating identical slow-body pairs, P50/worst cancellation latency, early HTTP closure, original vs candidate abandoned response bytes, CPU/RSS and foreground retry are archived in JSON. BEFORE must truthfully remain uncancelled while mounted; candidate must cancel each request <=160 ms and send zero late response bytes, recover on foreground and reduce paired P50 by >=50%. No inferred overall 100k render speedup.

These local native HTTP n3 pairs do **not** replace independent real 100k distinct-CAS media or Go Request.Context.Done tests, which remain separately required. Original 100k Go browser scroll and Owner/Share root/security tests must be kept unchanged. No production data/credential or artificial 100k media is represented in this test.

## Safety/ownership

No call to user-initiated upload/download, ZIP/archive, SyncRun, file delete, native save, task-center cancel or Owner/Share authorization. On backgrounding only rendering-related thumbnail reads are affected. No Race source modifications. Production-only inaccessible security acceptance: 按用户决定跳过（未验收）. Do not mark Ready/merge before same-exact-HEAD specialty n3 + full Web/Desktop/Linux/Windows/Go CI and final gate succeed and clean mergeability.

## 2026-10-22 · Exact prior HEAD paired result and full-CI fixture correction

The original [source-exact P070 n3 test #39633558205](https://github.com/lazyxu/xdrive/actions/runs/39633558205) on HEAD `e39b69b68a8ee207606888c7bf7e2a42670aa58b` succeeded. Frozen master `95ac411a9cf10fdfa6650be669ab381e5d7b5d18` vs candidate on the SAME runner: hidden mounted-thumbnail HTTP cancellation P50 **645.826ms BEFORE / 1.430ms AFTER** (-99.78%), 98304→0 abandoned bytes across three paired samples, all foreground retries succeeded; original never canceled. This is synthetic slow-body HTTP transport only, **not a 100k Go/physical CAS or whole-app speedup**. Preserve this successful evidence without claiming it proves a later candidate SHA.

That original exact HEAD [full CI #39633553044](https://github.com/lazyxu/xdrive/actions/runs/39633553044) was RED in `desktop-tests` because the only-on-specialty `XD_P070_BASE_SHA` environment was absent from ordinary shallow CI. Restack on full current master, run a real candidate HTTP transport abort + foreground retry in the default desktop tests under the same <=160ms and zero wasted-byte gate; the original `XD_P070_BASE_SHA`-activated full-history specialty retains all three alternating original/candidate pairs, SHA immutability, CPU/RSS recording and previously frozen thresholds. **New exact HEAD still needs independent dedicated n3 and complete CI/Final Gate and clean mergeability before merging.** All persistent upload/download/ZIP/sync/delete cancellations remain untouched. Production-only unavailable acceptance: 按用户决定跳过（未验收）.
