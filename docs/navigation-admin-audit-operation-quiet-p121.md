# P121 · Stable Audit virtual table and quiet FileOperation first history read

**2026-10-20 — source-confirmed gap after P110–P120.**

## Real layout defects

1. Original shared Admin Audit filter/Range error was inserted as a conditional `XDriveStatusAlert` inside `<Stack spacing={2}>`, between the filter toolbar and the already-mounted sparse virtual table. A late network failure therefore adds one ordinary-flow sibling and pushes the accepted list, its scroll container and its original viewport. This is independent of the already-completed P63/P80 initial-read and filter staging.
2. Original shared Task Center FileOperation history returned a visible `XDriveStatePanel loading` with “正在加载文件操作…” during the first empty pending request. That is an ephemeral navigation/loading page, not useful operation progress.

## Minimal corrections and invariants

- A late/refresh Audit error is still a truthful accessible alert, but lives **outside the filter/table Stack** in a bounded fixed, safe-area-aware, pointer-transparent owner. Real error text is retained. For a genuinely failed initial read, keep that same diagnostic and generic failure copy *inside* the pre-existing silent 180px first-read region. Verified zero, abort/stale generation, filters, table virtualization and scroll restoration are unchanged.
- The first Operation history request uses a silent, bounded 180px `aria-busy` slot; after a verified result the original three groups and genuine empty text are shown. Every running transfer and FileOperation still reports its real bytes/speed/ETA and retains Cancel, Retry, Undo, Redo and conflict actions. No Server/Agent/Go/IPC, scheduling, response semantics or artificial wait.
- Dedicated original TypeScript JSX AST/source regression checks the actual audit DOM ancestry, stable cold footprint, error text and original operation controls. Prior `admin-audit-quiet-staged.cjs`, operation-control contracts and full Web/Desktop/Go/Host tests remain active.

## Validation

Source-only changes on full latest master, ONE scoped work commit, full historical `AGENTS.md` preserved additively. **DRAFT until exact-head full CI / real PostgreSQL API Race / Final Gate green and fresh GitHub clean mergeability**. Native iOS 375/390/899, physical Android/PWA, WAN, 100k CLS/FPS, physical Electron window resize remain unmeasured — do not claim these from source review. Independent open P112/P116/P118/P119/P120 PRs are not modified.
