# 传输与任务

## 入口与范围

宽屏 Web 与 Desktop 在右上角头像旁使用同一个 `XDriveTransferPopover`。Mobile Web 的全部应用占满完整可用视口，全局顶栏和底部导航不占空间：通过44px“打开应用导航”悬浮按钮，在按需浮层内访问账号旁的上传/下载入口。该入口显示当前上传、下载速度与活动传输数量，点击打开同一共享传输浮层，保留当前工作区、目录与浏览器历史。窄屏浮层受视口约束并在内部滚动；Desktop 的入口及浮层不参与标题栏拖动。不得为了持续展示速度而恢复移动全局 header/footer；遵守 [Mobile Web](mobile-web.md) 的全屏硬约束。

| 入口 | 内容 | 可见范围 |
| --- | --- | --- |
| 宽屏右上角 / Mobile 应用导航中的上传与下载 | 当前客户端的手动上传、下载，以及 Desktop 自动同步与水合产生的网络传输 | 当前客户端 / 账号 |
| Sidebar / Mobile 应用导航：任务 | 文件复制、移动、删除等操作；同步文件夹运行；准备压缩下载、媒体处理等服务器后台任务；缓存释放等本机工作 | 当前用户 |
| Sidebar / Mobile 应用导航：全局任务 | 所有用户及系统后台任务 | 管理员 |

同步运行本身保留在任务中，其实际上传/下载字节显示在传输浮层。缓存释放（dehydration，`direction=local`）不计入网络速度。Sidebar 的任务徽标也不再计算上传和下载。管理员的全局入口在窄屏应用导航浮层中；页面、导航与服务器管理员接口均保留角色限制。后台控制按钮继续由服务器 `control_actions` 决定。

浮层复用共享传输树，保留活动记录、历史、文件夹分组、进度、耗时、速度和可用的重试能力。父子传输不重复计算速度或顶层任务数量。主页的“传输”快捷入口及 Desktop 原生传输导航打开同一浮层。

## 实时速度

当前速度与逻辑文件完成进度使用不同的数据来源。跳过、秒传、续传复用的已存在字节可以推进逻辑进度，但不能计为当前网络流量。无流量、排队、重试等待、结束处理或过期样本不继续显示先前速度；平均速度不能代替当前速度。

| 路径 | 当前速度来源 | 完成含义 |
| --- | --- | --- |
| Desktop 上传 / 自动上传 | Agent 按 HTTP 请求体实际消耗的字节独立采样 | Agent 报告的传输结果 |
| Desktop 下载 / 自动下载 / 水合 | Agent 流式读取进度采样 | Agent 报告的传输结果 |
| Web 上传 | 上传请求的实际网络进度，包括尚未完成的分块 | 上传流程完成 |
| Web 可直写磁盘的下载 | 流式响应读取的字节计数 | 下载与写入流程完成 |
| Web 原生浏览器下载 | 服务器成功写入 HTTP 响应体的字节采样 | 服务器发送完成，不证明浏览器已收齐或保存到磁盘 |

原生浏览器路径继续交给浏览器下载管理器，不把整份文件缓存为 Blob。对应速度与明细标明“服务端发送”。ZIP 的响应流字节计数与原有逐文件逻辑进度独立；响应中的 ZIP 头等实际发送字节计入网络速度。服务端失败或浏览器取消时展示观察到的结果；浏览器自身是否保存成功仍以浏览器下载管理器为准。

Desktop 上传在请求体进行中按 250 毫秒节流发布字节样本，并在请求体结束时刷新最后一段，因此首个大分块尚未完成也能显示速度。该计数包含实际重传，不包含哈希读取和续传复用的分块；它表示客户端 HTTP 传输读取的请求体字节，不代表服务端确认接收。原有逻辑分块进度和同步源的上报频率保持独立。重试会使上一轮迟到的网络样本失效。

如果服务器不提供可用的下载跟踪能力，文件仍按原生流程交给浏览器，并将本地记录标为“由浏览器下载”。跟踪失败不能阻断有效下载，也不能伪造下载完成或实时速度。

## 原生下载观察接口

签名下载票据可返回独立的 `transfer_id`。当前用户通过认证接口 `GET /api/v1/download/progress/:id` 查询 `state`、`bytes_sent`、`bytes_total`、`updated_at` 与可选错误。观察记录只属于签名票据的用户和会话版本，不是后台任务。

服务器将短期观察记录存入 PostgreSQL，使下载请求与查询请求可以落在不同实例。票据中的随机 JTI 区分并行下载。响应写入计数在内存累加，约每秒写一次快照并在结束时写最终状态；不会为每个数据块写数据库。30 秒没有心跳的运行记录在查询时显示中断，30 分钟不活动后过期；过期记录随后续票据活动清理。存储不可用时下载仍可执行。

每个响应使用独立请求标识上报累计字节，数据库仅增加尚未记录的部分，并对终态幂等处理。短暂写入失败或提交成功后确认丢失时，后续快照能补齐计数，重复终态也不会误结束另一个并行 Range 请求。最终状态最多尝试三次，共享两秒截止时间，避免可选统计无限阻塞响应结束。

仅统计成功写出的响应体字节。HEAD、304、412 和无效 Range 响应不作为文件传输完成；错误响应体不计入文件速度。并行 Range 请求共享一次运行，后续重试使用运行标识隔离迟到报告。`bytes_sent` 包含重传与 multipart Range 封装，可能超过文件表示大小；原生 ZIP 总字节数在服务端完成之前未知。

## 生命周期与清除历史

浮层打开状态在 Viewer 打开、账号或服务器切换时清除，不在返回后自行重开。Mobile Web 关闭应用导航或跨越窄屏/宽屏断点时也关闭传输浮层，避免留下失效锚点。Web 的同账号令牌刷新保留当前传输跟踪，并使用更新后的 API 继续采样；登出或切换身份会停止旧采样并拒绝迟到结果。

传输浮层中的“清除历史”仅清理已结束的上传/下载。任务页“清空历史”保留原有文件操作历史清理，并只清理本机非网络传输历史；两处均保留活动任务及其完整子任务树。

Desktop 的 `DELETE /v1/transfers?scope=network|local` 和 `transfer-history-scope` capability 明确区分两个范围。不带 scope 的旧客户端仍保持原有 all 行为；新版 UI 只在 Agent 声明支持范围清理时启用对应清除按钮，避免旧 Agent 忽略 scope 后误清其他历史。

## Task Center request ownership and race validation (2026-10-10)

Background Task Center has three independent asynchronous read lanes: owner/admin
page refresh, cursor history continuation, and active-summary badge counts.
Previously all three could apply an older response after a newer query had
already completed. Deterministic first-red on their **actual shared callbacks**
reproduced `fresh-B -> slow-A` list regression, `1 -> 9` stale badge count,
and appending an old cursor page into a new collection.

Current candidate uses a current-request generation for summary and first-page
reads; old errors and loading finalizers are ignored as well as old data.
Starting a new page refresh also invalidates pending history continuations.
Owner/transport/capability and collection scope changes invalidate in-flight
reads; Web supplies its account identity and Desktop supplies Server/user
identity to the same shared MUI Task Center lifecycle. A newly selected
account does not show the previous account's loaded background tasks or
summary on the first render. This does **not** cancel durable Server jobs,
change their execution status, or poll more frequently.

Acceptance requires the new executable real-callback interleaving regression
suite plus existing task controller/role/transport tests, Web/Desktop builds,
Go race, and the exact-head GitHub final CI gate. Native account switching
and real remote Agent/browser device evidence remain separate.

The real shared refresh callback additionally reproduced three unwanted page
reads on three otherwise unchanged Desktop renders because an inline
`onBackgroundTaskError` handler changed identity. Keep its latest error
handler in a ref so only current requests report errors; replacing the
handler must not restart the list polling effect. The executable regression
uses React-style `useCallback` identity comparison on the real callback.


## Background Task Center control ownership (2026-10-10, PR #1242)

The shared Web/Desktop background-task control callback owns one synchronous
Cancel/Retry command lane per authenticated transport and lifecycle identity.
React's next-render Busy presentation is **not** the duplicate-submission
guard: a second handler invoked from the same render must be rejected before
issuing any other Server command. An in-flight command remains a durable
Server-owned operation when the user changes accounts or Agent capabilities;
the new identity gets an independent, immediately available UI control lane.

An obsolete operation completion must not clear the new account's Busy,
refresh its task lists, or publish the old account's error. Current-scope
commands still refresh the authoritative task page and summary after success;
neither polling intervals nor long-running Server execution semantics change.

**Product first-red:** GitHub Actions run 38016434165, real React hook tests
1505–1507: two Server Cancel commands for same-render double-click, old A
Busy blocking account B, and old A error leaking into B. The independent
single-command control 1508 passed. Regression suite
`desktop/tests/shared-task-center-control-race.cjs` preserves the original
three failing tests unchanged for green retest. Require original interleavings,
the existing Task Center async race/role tests, Web/Desktop validation,
Go race, and exact-head full GitHub CI before merge.

## Legacy Agent folder-upload scan ownership race (2026-10-10, PR #1261)

The shared FileExplorer upload controller supports older Desktop Agents
without `transfer-lifecycle`. This compatibility path resolves the folder
targets asynchronously before calling the existing flat `runTargets` upload
pipeline. It must synchronously own the same upload Busy lane **before**
directory scanning starts. A second same-render folder action must not scan
the same 10k/100k tree again, and a flat upload must not overtake a pending
folder scan. The UI keeps Busy visible through the scan-to-upload handoff,
including no-target and scan-error cleanup. Handoff to the existing flat
upload conflict batch occurs synchronously with no event-loop gap, and
session/lifecycle generations continue to reject old work.

**Original production first-red:** CI run `38020325878` on test-only
commit `fb84970ac02bdcdc8f55ea420fdafb4bd3a9930a`,
real React hook tests `desktop/tests/shared-upload-legacy-folder-scan-race.cjs`:
#1584 twice-scanned one folder (2 vs expected 1); #1585 failed the
pending-scan Busy contract; single upload and old-session controls #1586
and #1587 were green. The same four tests must turn green on the amended
fix commit; retain the existing hierarchical group lifecycle, conflict
resolution, error reporting, Web/Desktop build and Go race contracts.
This is a correctness/lifecycle fix, **not** a measured throughput gain;
do not claim 100k performance improvements without separate benchmarks.

## Grouped upload registration and detached session terminal states (2026-10-10, PR #1266)

The shared Web/Desktop `FileExplorerUploadController.runGroup` must not
leave queued/running transfer *tracking records* when a session or Agent
capability changes **before the first actual file upload starts**. Once a
group/child registration Promise returns, its IDs exist in the originating
transfer Port even if the UI lifecycle is now obsolete. The old Port should
best-effort `finish(id, {state:'cancelled'})` for those unstarted children
and group rather than exiting without a terminal state. This preserves old
session ownership and never sends the finish command through the new
session. Existing server-owned durable operations and already-started file
uploads must not be cancelled merely by UI teardown or window switching.

**Real first-red, production unmodified:** GitHub Actions
`38021728014`, test-only commit
`56a6022e6dba858d0e84b668163b19e3b71c97ed`,
`desktop/tests/shared-folder-upload-session-terminal-race.cjs`:
four original real React Hook assertions **#1419–#1422** failed because
`finish` calls were entirely absent after late startGroup, directory
scan, batched startChildren, or sequential startChild. The normal same
session completed group/children control **#1423** passed. First-red
full desktop-tests: 1932 pass, 4 fail, 1 skip. The exact four
first-red tests are preserved for the fix's same-interleaving retest.

The minimal fix reuses the existing `finishQuietly` error-isolated Port
bridge on those pre-upload registration and initialization exit paths.
This is best-effort: an entirely unavailable old Agent may reject
terminal updates, in which case reconciliation is a separate responsibility.
No durable upload, Server API, Agent API, transfer speed or polling cadence
changes. Require the original tests, related FileExplorer/transfer suites,
Web/Desktop builds, Go race and authoritative exact-head PR final gate.

## Group upload preflight and error lifecycle races (2026-10-10, PR #1272)

The shared Web/Desktop FileExplorer grouped-upload controller must terminate
registered old Port tracking records when `lifecycleKey` changes **before**
a real file upload is invoked. The earlier PR #1266 fixed delayed successful
group and child registrations; this phase covers post-`begin(child)`,
initial `updateGroup`, late file preflight/decision, rejected directory scans
and rejected child registrations. Obsolete transport failures remain silent
in the newly selected account/session. Use the **initiating** Port for
best-effort `finish(cancelled)` of the unstarted group and children; do not
write into the new session.

A `fileUploadStarted` boundary is established immediately before the first
actual upload invocation. Once dispatched, the Server/Agent owns the transfer:
old UI completion/error must not call `finish(cancelled)` on that in-flight
durable operation. This intentionally leaves independent cancellation and
unreachable old Agent reconciliation to their own established mechanisms.

**Product first-red before production changes:** GitHub Actions
`38024655089`, test-only commit
`32e5c3b9f01f92c87198ea6c6ac0246a1dd0ec4d`,
`desktop/tests/shared-folder-upload-session-terminal-race.cjs`:
#1429 delayed begin(child), #1430 delayed group update,
#1431 delayed preflight, #1432 old scan rejection and #1433 old
child-registration rejection all omitted required terminal calls (RED).
The current-session preflight-failure control #1434 passed (GREEN).
Full Desktop: 1942 passed, 5 failed, 1 skipped. All original
first-red assertions are preserved unchanged for green retest.
A supplemental control verifies that already-dispatched upload commands
are not terminalized by UI detachment. Do not claim strongly guaranteed
cleanup when the old Agent is unavailable or cancellation of durable uploads.
Require exact-head Desktop/Web builds, Go race, Windows artifact tests, and
GitHub PR final gate before merge.

## Mixed completed and unstarted grouped uploads at session detach (2026-10-10, PR #1281)

The shared Web/Desktop grouped upload Hook must distinguish **an upload
currently dispatched and unsettled** from **any earlier file that once
uploaded successfully**. The old permanent \`fileUploadStarted\` latch protected
genuinely in-flight Server/Agent uploads but mistakenly suppressed closure of
later, never-dispatched children after a previous child reached its terminal
state. The fix releases that guard only after the initiating Port confirms
that child's terminal completion/failure; old real uploads and their unsettled
terminal acknowledgements remain outside UI-triggered cancellation.

On an obsolete lifecycle with **no actual child upload in flight**, the
originating transfer Port finishes only nonterminal child records:
\`cancelled\` for siblings not yet uploaded, without altering earlier
\`completed\` or \`failed\` children. The group reaches \`partial\` if any
prior child succeeded or was skipped, \`failed\` if only failed children
preceded detach, and \`cancelled\` if no file completed. This is a
**best-effort tracking cleanup**, not an authoritative cancellation of
already-running durable Server/Agent work. It never changes new-account
records or sends an upload cancel across the session boundary.

**Original unchanged-production first-red:** GitHub Actions
\`38030327193\`, test-only commit
\`e1b20d925156dfc91d7d79f13960adca1c1be53e\`:
real shared React Hook tests #1439–#1443 failed deterministically because
only the first \`completed\`/\`failed\` child had a terminal event; the pending
second child and root were left active. Controls #1444 (second real upload
dispatched at detach must NOT be terminalized) and #1445 (ordinary two-file
completion) passed. Full first-red Desktop: 1965 passed / 5 failed / 1
skipped. Preserve all seven original tests unchanged for the same-interleaving
green retest. An additional test covers first-child terminal acknowledgement
crossing the session boundary. Verify exact-head full Desktop/Web/Go race/
Windows artefacts and GitHub \`final-gate\` before merge.

## Transfer speed presentation and history (2026-10-10)

Web and Desktop use the same shared TransferSpeedDisplay presentation
cadence: each active transfer rate is sampled for display every 2 seconds.
The numeric speed can no longer flicker for every byte callback; byte
counts, progress bars, status, cancellation state, and terminal receipts
still update immediately. Sample timestamps are preserved verbatim:
unrelated progress/state events must not renew an old network speed.
The timer continues while active even when no transfer events arrive, so
the shared 3-second freshness policy clears an idle rate to zero instead
of leaving a frozen value on the header or Task Center. History compact
rows show **stored average speed**, not `0 B/s` current speed.

The Web transfer-history store serializes its records (including
`average_bytes_per_second`, elapsed time, terminal state and timestamps)
to the origin/account-scoped browser `localStorage` key beginning with
`xdrive.web.transfer_history`, retaining up to 200 root histories.
Desktop keeps Go Agent transfer history and terminal average rates in its
`transfer.Manager` process-memory snapshot (up to its configured history
limit); these are **not guaranteed to survive an Agent restart**.
No persistent Desktop database or server-side per-device history is claimed
in this phase. Native-browser handoff cannot invent a completed download's
end-to-end average without actual observed bytes. A `server` source
remains explicitly labelled as server-send speed, not browser receipt.


## Desktop tray transfer-rate expiry (2026-10-10)

The Desktop OS tray is an additional speed display, separate from the shared
React Transfer Popover/Center. It now holds an Agent rate sample for a 2-second
presentation interval, while allowing progress and transfer-state snapshots to
update immediately. A clock-driven refresh continues for active transfers even
without incoming Agent events; samples older than 3 seconds expire to zero.
The sample key combines transfer ID and attempt start time so new attempts do
not inherit old speed. Queued/finalizing/cancelling transfers never advertise
wire throughput. Neither this change nor the shared UI throttle delays bytes,
upload/download work or transport progress events.
 

## Direct Web transfer cancellation (2026-10-10)

Scoped P0 phase: explicit **cancel only**, not pause/resume. The shared Header
transfer popover renders `取消传输` only for a real, currently registered
abortable request. Web's ordinary standalone chunk upload and its
direct-to-disk streamed download use a transfer-specific `AbortController`
composed with the existing account/session abort boundary. Cancellation
immediately sets `cancelling`, aborts that exact network request, and marks
`cancelled` only when the original execution acknowledges the abort. The
request's finalization and late results cannot become a successful task.
Other concurrent requests are not aborted, and the cancellation callbacks
are ephemeral and never serialized with the history data.

Not yet cancellable: browser-native download handed to the browser,
archive/folder group transfers, retries owned by an Agent, and Desktop Agent
upload/download requests. These do not expose a fake cancel control. Closing
an app/view is not a durable cancel operation, and changing accounts retains
the existing session-wide safety fence. Tests exercise actual XHR abort,
stream/sink abort and handoff exclusion. Exact-head PR CI is required before
this candidate can be marked merged.
 

## Desktop Agent-owned transfer cancellation (2026-10-10)

Desktop's direct single-file upload and download now bind the actual Go
`context.CancelFunc` for that request to its unique transfer handle. Agent IPC
advertises `transfer-cancel` only on new Agents; the Electron Main process
requires that capability and invokes an authenticated local
`POST /v1/transfers/cancel`. The Server is **not** told to cancel arbitrary
durable jobs. The shared header only offers cancellation while its trusted
Agent snapshot reports `cancelable=true`. A click moves the task into
`cancelling`, causes the specific owned context to be cancelled, and marks
it `cancelled` once the worker sees `context.Canceled` and finishes any
temporary-file cleanup. A completion that already committed before
cancellation remains a genuine completion, not a fake cancellation.
A second cancellation or unbound task yields a clear error.

Excluded: FUSE hydration, sync-folder runs, folder/ZIP group work, externally
tracked uploads, handed-off browser downloads, and real resume/pause. Avoid
terminating durable background tasks on window close. Further phase must cover
folder ownership and supported local file reveal; do not expose controls in an
old Agent without `transfer-cancel`. Test and exact-head CI required.


## Desktop Agent transfer history persistence (2026-10-10)

Prior to this change, the Go Agent's `transfer.Manager` retained its terminal
speed averages in process memory only; a restart erased the list. Desktop now
stores terminal task snapshots, including `average_bytes_per_second`,
`elapsed_ms`, `completed_at`, direction and group progress, in a private
per-device/per-server/per-account JSON file:

```text
<os.UserConfigDir()>/xdrive/transfer-history-v1-<SHA256(server + NUL + username)>.json
```

Typical OS configuration roots are Windows `%APPDATA%\xdrive`, Linux
`$XDG_CONFIG_HOME/xdrive` (default `~/.config/xdrive`), and macOS
`~/Library/Application Support/xdrive`. The exact path comes from
`internal/userconfig.Dir()` and the system account environment. It is **not**
a Server or shared history database.

Disk writes use a private `0600` file, private `0700` directory, sync +
atomic replacement. The Agent coalesces **terminal/root history changes**
rather than writing on every network-progress callback. Normal Agent shutdown
flushes the latest snapshot. Account/logout boundaries persist old history
before clearing active state; login loads only the matching Server/account key.
`清除历史` also writes an empty/filtered disk snapshot to prevent reappearance
after restart. A corrupt/mismatched file is rejected and reported in Agent
logs, not interpreted as somebody else's history.

Only complete terminal roots and terminal children are restored, with a maximum
of 200 roots in the running manager and 10,000 rows in the serialized file.
A huge folder retains its root summary even if child details exceed the cap;
live/aborted-in-progress work is **not** revived as an active transfer on Agent
restart. Go retry callbacks and cancellation actions are always disabled on
restored records. Completed average speed is preserved verbatim; this is not a
promise of re-downloading browser-native handoffs.


## Desktop folder-tree download cancellation (2026-10-10)

**Status: exact-head CI candidate.** Desktop's Agent-owned cloud folder
download now binds the existing group transfer root to one real Go
`context.WithCancel`. Cancelling the group through the already-shipped,
ID-only Agent IPC `POST /v1/transfers/cancel` interrupts the ongoing
paged folder scan or file download, instead of changing a UI label only.
The group can only affect its own request context; other downloads, uploads,
mount hydration and scheduled synchronization continue.

The Agent's on-disk temporary file is removed if cancellation arrives after
network response but before the destination file rename. A folder cancellation
closes remaining queued child tasks without initiating further downloads.
An already committed child remains completed and yields a `partial` group;
a group with zero completed children becomes `cancelled`. Directory scans
that abort with `context.Canceled` are marked cancelled, not failed. Root
progress reflects zero queued/running children at the terminal acknowledgement.

This phase intentionally does **not** claim archive ZIP extraction,
Desktop-renderer-orchestrated folder uploads, or browser-native handed-off
downloads are cancellable. Future phases must provide an owning cancellable
context and cleanup at each of those boundaries before showing buttons.

Validation: root-owned Go cancel/snapshot unit tests, Desktop IPC and shared
transfer contract tests, and exact-head full CI. Actual large-folder remote
abort should be checked on physical Desktop/Agent; the code-level tests are
not equivalent to that manual observation.


## Web grouped-file uploads: task-ID scoped real cancellation (2026-10-10)

**Status: CI candidate, not yet merged.** Following the merged standalone
Web/Agent cancel handlers (#1302/#1307), Web FileExplorer's grouped/folder
upload no longer has an inert cancel gap. A group root registers one ephemeral
`AbortController` tied to its existing account/session `AbortSignal`.
Its `取消传输` button triggers the owning controller, aborts the currently
dispatched child XHR/chunk session, and prevents every not-yet-dispatched child
from starting. Web preflight HTTP requests also consume this exact abort
signal, so cancellation releases an in-flight preflight request rather than
merely dropping its result. Local asynchronous directory enumeration has
no remote HTTP connection to cancel; its final result is discarded before
opening any new uploads.

The shared folder Upload Controller uses an **optional** `isCancelled` and
`abortSignal` lifecycle contract. Desktop or old Agent adapters without this
capability do not claim grouped cancellation. The active child is terminalized
only after its actual network request rejects/settles. Queued children become
`cancelled` without dispatch; already committed children remain `completed`.
The root becomes `cancelled` if nothing committed, or `partial` if one or more
files were already uploaded or skipped. Group speed and byte metrics remain
source-derived and no upload throttle is added. Cancellation callbacks are
removed at the terminal receipt or account disposal and never persisted with
browser history.

This phase **does not** control handed-off native browser downloads, Agent
folder/ZIP transfers, FUSE hydration, durable device backup/sync, or pretend to
implement pause/resume. Tests cover real XHR and preflight AbortSignals,
queued sibling prevention, partial-success preservation, enumeration
cancellation and unchanged normal session-lifecycle regressions. Exact-head
GitHub CI and physical Web/Windows checks remain separate acceptance gates.
