# L03-Enable-2 — Agent-owned real first-file upload after Desktop disconnect

## Accepted behavior

The merged #2212 Windows/Linux owning Desktop action sends a real Backup-only
first file (up to 64 MiB) through authenticated Agent-held native original,
HTTP Stage, CAS/SQL commit and historical physical/native observation. It is
already available in code; no production environment safety acceptance will
be requested as a prerequisite to its implementation or release.

## Change in this increment

The Agent keeps an in-memory, per-Server/account/session/Source job future.
The incoming Desktop IPC request may disconnect or time out while the actual
physical work continues under the Agent process context and original 8-minute
deadline. A later request for the exact same identity joins the original job:
no repeated Stage, key, operation or file write. Up to 128 results are retained
per Agent process; only one physical job is active at a time. Other accounts
cannot inspect or launch work against the original Source's job.

The original Server/Agent native identity, Root, Source revision, device
authorization, Stage, CAS and SQL checks are unchanged. Shutdown cancels the
Agent-owned context. A crash loses the in-memory join result but NOT the
existing durable OS Stage/request-key claims: an ambiguous file remains
quarantined rather than automatically reuploaded.

Desktop UI now explains that closing its window does not cancel Agent work
while Agent remains alive. No Web/Mobile or foreign Desktop write permission,
generic Source trigger, public Server route, additional file, automatic
scheduler, SourceRun completion, Mirror deletion, physical CANCEL, or
Stage/key retirement is introduced.

## Remaining work and evidence

This is a real process-lifetime reliability improvement to the existing
single-file upload, not yet a durable multi-file/scheduled backup Runner.
A fresh complete PR CI, including Go Linux/Windows and genuine PostgreSQL
Race, Web/Desktop, artifacts, rootless and Final Gate, is still required.
No installed-device production, 4 GiB or 100k acceptance has been performed
or will be demanded of the operator: report NOT VERIFIED, not PASSED.

Next increments: file-writer quiescence, authenticated physical terminal
reconciliation across Agent restart, key/Stage retirement, repeatable
multi-file operation and bounded auto scheduling.
