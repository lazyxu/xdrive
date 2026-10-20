# P117 · Cloud, Global Storage and Admin Users async statuses without reflow

2026-10-20 · Original shared-Web/Desktop source audit after P109–P116.

A same-scope refresh failure in Cloud Storage previously inserted a normal-flow error before accepted quota/CAS metric cards. Global Storage did the same before the physical inventory and added a staging-cleanup success row inside an existing `Stack spacing={1.5}`. Admin Users added a failed-refresh error as a new child of `Stack spacing={2}` before the existing user table. All three can shift existing content even though no authenticated page navigation occurred.

In this minimal repair, cold unverified first reads retain their existing silent 180px slot and true terminal error. Once a trusted snapshot/users table is mounted, real refresh errors and staging cleanup success live in bounded, fixed, safe-area-aware status surfaces that are **outside the MUI spaced Stack**; the original refresh buttons, metric cards, scopes, real task progress and access controls stay untouched. There is no new spinner, timer, Server/Agent/API request, credential handling, cancellation or media thumbnail change.

`desktop/tests/storage-admin-no-reflow-p117.cjs` parses actual original TSX JSX ancestry, checking exactly one out-of-flow owner, no spacing Stack ancestor and preserved cold/verified/error semantics. Keep all old Cloud/Global/Admin original tests and full fresh exact-head CI/Final Gate green before merge. Native iOS Safari/Android/PWA/WAN/100k CLS and FPS are NOT RUN; source tests are not real browser geometry measurements. Root `AGENTS.md` already mandates the P78/P110/P111 anti-reflow invariant; do not create a parallel competing policy document.
