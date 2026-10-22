# G2c2d2b3c4e — private original terminal replay across PostgreSQL pools

## Scope and measured evidence

This Stage-1, test-only increment exercises the already-merged **PRIVATE, UNROUTED** original-operation physical-COMMIT SQL/CAS writer and pinned readback (#2354 and #2359). It uses a synthetic held-native witness **only to seed a PostgreSQL integration fixture**; that synthetic value has no production authority.

The test opens two genuinely separate PostgreSQL connection pools against the same isolated test schema and Local physical CAS. After the test-only terminal is written, a second Server instance reads and verifies the exact original Operation UUID/generation, Stage, original 32-byte request key, canonical immutable Node/SourceItem, and physical CAS. It then closes the original Server's SQL connection pool and repeats read-only replay through the second pool. A wrong original request key fails closed, no duplicate terminal or SourceRun is created, the first SourceItem remains pending, and revocation of the owning Device makes subsequent recovery unavailable.

This is a **controlled Server-side lost-ACK / restart-read simulation**, not an actual Agent/Server process kill, native kernel-lock attestation, trustworthy production physical COMMIT/CANCEL, or automatic recovery of an original upload. No REST/Agent IPC/Renderer/Web endpoint is added; no Stage/Key/Writer retirement, second-file admission, multi-file Runner, SourceRun or scheduler is enabled. `backup_complete=false` and `retirement_safe=false` remain required.

The test requires the existing real PostgreSQL `XD_TEST_DATABASE_URL` integration fixture and local physical CAS. Run it as part of authentic Linux PostgreSQL API Race CI; source-exact Go Windows/Linux, Web/Desktop/artifact and Final Gate remain mandatory. Inaccessible production-environment security acceptance is **按用户决定跳过（未验收）**, never a development/CI/PR merge gate. Code-level Owner/Device/Root, SQL/CAS and fail-closed regression gates remain mandatory.
