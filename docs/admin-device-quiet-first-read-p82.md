# P82 · Admin/Device verified-first navigation (2026-10-19)

## Confirmed source findings

After P77–P81, three shared workspace surfaces still showed a delayed (300ms) *cold* loader on an ordinary page switch: `AdminUsersPage.tsx` (“正在加载用户…”), `AdminAuditPage.tsx` (“正在加载审计日志…”), and `DeviceBackupPage.tsx` (“正在读取设备备份…”). These were decorations attached to the first source/Owner-specific network read, not task progress. They could materialize after the page had already reserved 180px and then disappear.

## Committed behavior

| Transition | Required UI | Kept function |
| --- | --- | --- |
| Before the initial API/Agent GET (including `loading=false` pre-effect) | Silent original 180px region; `aria-busy=true`; fixed header | Authenticated request runs immediately |
| First GET held >350ms / slow network | Identical silent region, no inserted `StatePanel`, label or animation | Owner/session/request/Abort boundaries unchanged |
| First authorized empty page | Display verified empty and stable geometry | Retry/refresh |
| Real first error | Visible actual error and retry | No invented successful empty result |
| Refresh of populated, authorized same-source list | Keep accepted rows and existing non-reflowing progress line only if slow enough | No new loading row, no altered button icon |
| Switch Owner or Server | Never show previous Owner's rows/refresh progress | Existing session fences unchanged |
| Device folder paging, timeline, thumbnail, transfer or durable task | Preserve truthful progress and pagination | No Server/Agent interface changes |

## Acceptance evidence and explicit limitations

- Updated the **original** three Desktop Node source contracts to reject the former delayed cold loaders, while asserting the original accepted-refresh feedback, error/retry, account fencing and 180px region.
- New `desktop/tests/admin-device-first-read-mounted-p82.cjs` mounts **original** Admin Users and Device Backup React renderers with deferred authentic interface calls; checks held >350ms and accepted data/refresh/owner-switch boundaries. Existing Audit virtualized filter/query tests stay active.
- Must pass full source-exact 77-job CI including genuine PostgreSQL API Race, Web/Desktop Linux/Windows/Rootless, one-commit and Final Gate, plus fresh clean mergeability. Browser-level 375/390/899px/Audit compiled-Chromium, iOS Safari/Android/installed PWA, real slow WAN, physical 100k and frame pacing/CLS **NOT RUN**; never claim physical release GO from these source/mounted tests.

## 旧 Web GUI 文案 CI 修复（2026-10-19）

首个准确 P82 HEAD `c22e95f144062a23e136a2cec49e2310b78cfd3d` 的完整 CI [#39144026600](https://github.com/lazyxu/xdrive/actions/runs/39144026600) 为 RED：Web 的 `check-gui-chinese.mjs` 仍然**强制要求旧 Loading 文案**“正在加载审计日志”；Desktop、Server 与其他已执行构建并无相同失败。新提交用原来真实的 `data-xdrive-admin-audit-first-read` 和“审计日志读取失败，请重试。”取代这个过时的正向要求，同时**禁止**旧 Loader 文案复活；不删除或禁用语言质量门禁。后续必须用全新最终准确 HEAD 完整 CI 验收，旧 CI 不可重用。