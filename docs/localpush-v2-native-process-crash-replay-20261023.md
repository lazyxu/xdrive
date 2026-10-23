> **2026-10-23 current parent status:** #2424 was merged into master at `e35b56d67b6fa03c44c7841070e4419023355974` after its exact-head complete 77-job CI and Final Gate passed. This child is now directly based on the merged master with only an isolated, real OS-process-kill E2E; its own new accurate-head CI is required. The historical dependency wording below is retained for context.

# Local Push v2 — genuine native subprocess death and original SQL receipt replay

Parent: [#2424](https://github.com/lazyxu/xdrive/pull/2424). That PR implements an **unrouted** owning-Agent private native offset-stream bridge into the existing ordinary authenticated UploadSession + per-file immutable SQL receipt. This child adds a targeted end-to-end regression in `internal/api/local_push_common_native_process_kill_e2e_integration_test.go`.

## Genuine boundaries exercised

1. Use a temporary PostgreSQL schema and actual physical LocalCAS; enroll an ephemeral owning Device and native Root and persist a fully verified CURRENT inventory.
2. Launch a distinct Linux/Windows Go test executable, pass only synthetic authenticated fixture credentials over one-shot stdin, then prepare the original file Plan and upload its true held native bytes with the real Go Client through Gin HTTP.
3. The parent HTTP handler calls the **genuine** ordinary Finalize endpoint, waits until HTTP 2xx and SQL/CAS commit, but deliberately withholds the reply.
4. Kill the actual uploader subprocess (Linux kill / Windows TerminateProcess) before it can receive the post-commit ACK; release the HTTP handler without ever giving it a successful reply.
5. Inspect the original durable SQL Operation and byte-for-byte actual CAS object, then start a new executable from the identical private Root journal and original Owner session. The new process must read the **same** original committed Operation without sending a new chunk/bind/Finalize.
6. Assert exactly one Operation, Node and unchanged FileVersion rows after replay. No raw user credential is written to the durable Operation journal.

## Scope restrictions

This is non-production controllable native/HTTP/PG/CAS test evidence only, not installed Desktop or Agent process execution. It does not implement recovery when the original operation was never committed, arbitrary network failures, a new-generation file, Stage/Key/Writer retirement, file B, SourceRun, cron/watcher, or Mirror. Do not infer physical cancellation from child death.

**Validation remains pending:** First merge #2424 after its own exact-head CI. Then align this child as one work commit on complete master, run genuine Linux+Windows Go (Windows PG execution where runner configuration supports it), PostgreSQL API Race, Web/Desktop, artifacts/images/install and Final Gate. Real production-environment safety acceptance is **按用户决定跳过（未验收）**, not a code/CI/PR gate.

## Additional child-process secrecy assertion

The crash scenario now also checks the terminated first child and the successfully restarted second child stdout/stderr for the synthetic Owner JWT and owning Device token. This does not replace normal log redaction, OS-private journal permission or Server authorization tests. Credentials still arrive only through test-process stdin and are never printed in a successful run.
