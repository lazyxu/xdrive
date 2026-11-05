# Offline Server Host preflight

The offline Server update workspace exposes a read-only Host preflight before an administrator can submit an offline installation.

## Flow

1. The administrator uploads the fixed offline release members through the authenticated Server API or Desktop Agent.
2. Web/Desktop submits only the import ID, trust mode and (for the explicit SHA-256 mode) two independently obtained digests.
3. The Server writes a fixed `plan-request.json` into the Host Control directory. It does not execute Docker, invoke a shell, or accept a Host path from the client.
4. The Host Control runner consumes the request and invokes the existing Host-owned `xdrive-server update --source offline --channel master --plan-only` path.
5. The Host verifies publisher trust and the selected release archives, then runs the Go planner with `--probe-host`. The probe uses read-only Docker information/inspect operations and filesystem capacity observations.
6. The Host writes a bounded JSON result and status. Web/Desktop displays blockers, image observations, known temporary-space requirements, component actions and checks that remain for installation.

## API and Agent endpoints

- Server API: `POST /api/v1/admin/update/offline/plan`
- Server API: `GET /api/v1/admin/update/offline/plan/{import-id}`
- Desktop Agent IPC: `POST /v1/offline-imports/{import-id}/plan`
- Desktop Agent IPC: `GET /v1/offline-imports/{import-id}/plan`

All endpoints remain administrator-only. Desktop IPC additionally requires the authenticated main-frame administrator and the `server-offline-import` Agent capability.

## Host Control protocol

The Host Control directory contains separate files for this operation:

- `plan-request.json`: fixed, short-lived request envelope
- `plan-active.json`: request currently owned by the runner
- `plan-status.json`: state, request identity, exact trust mode/digests and timestamps
- `plan-result.json`: bounded read-only planner result

The Host runner advertises support by writing `offline-plan-runner.pid` with the same PID as `runner.pid`. The API refuses to queue a preflight when the active runner does not advertise this protocol, avoiding requests that an older runner would never consume.

Preflight is serialized against update admission and offline-import mutations. An interrupted Host preflight is reported as failed; it is never retried as an installation.

## Trust and safety boundaries

- Sigstore mode accepts no uploader-supplied digest. The Host uses its own trust root and verified delivery evidence.
- SHA-256 mode requires both the Manifest and Host installer digests from an independent trusted source.
- Chunk/file upload digests are transport-integrity checks only; they are not publisher trust.
- The API container receives no Docker socket and does not execute the installer.
- The Host request contains no filesystem path, executable path, shell command or Docker arguments from Web/Desktop.
- The planner result is accepted only when both the plan and Host probe explicitly declare `read_only: true`.
- The preflight is evidence for the operator, not installation authorization. The Host rechecks publisher trust, exact candidate bytes, image identity, backup admission, health and rollback conditions during the actual installation.

## Interpreting the result

A blocker means the current read-only probe found a condition that must be corrected before the UI enables offline update submission. Remaining Host checks are deliberately not represented as passed: they require live build information or the full installation transaction and are repeated by the installer.

A successful preflight does not certify full Docker layer or backup capacity when the planner cannot reliably predict those requirements. Unknown capacity is displayed as unknown rather than inferred from the temporary-directory lower bound.
