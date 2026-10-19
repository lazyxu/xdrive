# P83 · Sync Folder / Task Center silent first reads (2026-10-19)

## Verified source defects
- Shared `SourceManager.tsx` scheduled a 300ms decorative loading timer and `SourceManagerListPage.tsx` swapped the Refresh icon on a slow existing-list GET.
- Personal and global `BackgroundTaskCenter.tsx` inserted delayed Loading StatePanels in **unverified** first task reads and collapsed their minimum content height on a verified-zero response.
- The optional `TransferCenter.tsx` cold-loading branch used an ordinary loading panel, rather than a silent semantic region. The current Web/Desktop task page normally mounts this component for accepted local transfers; the fix protects optional cold callers.

## Required presentation
| Scenario | Visible state | Actual work |
| --- | --- | --- |
| First GET before effect / held >300ms | Source 180px or task/transfer 120px *silent* region, `aria-busy` | Owner-scoped data fetch starts immediately |
| Authorized current-Owner zero / first failure | Verified empty or true actionable failure inside the same minimum geometry | Never show unverified zero or stale Owner |
| Sync Folder existing cards refresh | Last authorized cards and fixed Refresh icon; disabled while request runs | Original Source GET, selected ID and errors preserved |
| Running tasks, real transfer bytes, paging, cancellation | Real progress, ETA, status, retry and cancel remain | No API, Agent, Go, virtual list or transport changes |

## Regressions and evidence
- Update the **original** P66 Source mounted test plus original Source/Task/Transfer contracts so the old spinner is explicitly forbidden.
- `desktop/tests/task-source-quiet-mounted-p83.cjs` mounts the original shared Background Task list/global table and Transfer Center through idle-first read, >350ms pending, genuine error, authorized empty and same-owner refresh; verifies silent bounded slots and no transient StatePanel.
- P78, AGENTS.md and this policy remain mandatory for new Pages. NEW full accurate-head 77-job CI including real PostgreSQL API Race, Web/Desktop Linux/Windows/Rootless, one work commit, Final Gate and clean mergeability required.
- Built-Chromium Storage/Task native app navigation for 375/390/899px, real iOS/Android/installed PWA, weak WAN, physical 100k and CLS/FPS: **NOT RUN** by this scoped work. Never claim full iOS 27 parity or release GO from CI/source/mounted tests.
