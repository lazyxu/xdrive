# L03-Enable-3 · Own-device Agent first-file job read-only status

## Actual capability and scope

The already merged #2212, #2229, #2238 and #2241 enable a **real** manual owning Windows/Linux Desktop Backup-only one-file Stage → CAS/SQL physical upload (up to 64 MiB). An upload belongs to the Agent process rather than the window/IPC observer; closing the UI must not manufacture physical cancellation. The independent #2245 OS-kill regression and subsequent original quarantine read are separate safety proofs, not second-file admission.

This increment adds a **strictly read-only** same-Agent job observation. An owning Desktop may inspect its current process-lifetime job without invoking the POST start endpoint, creating a new Stage, issuing a new key, retrying bytes, or deleting any disk marker. It adds no permission to start, stop, cancel, rebind or mutate another device or Web/Mobile Web Source.

## Narrow transport and privacy

- Agent privately keys the existing in-memory job by exact current Server/account/session/Source. The GET checks current OS-store identity before and after reading; account/server/session changes cannot read a previous identity's result.
- Only four redacted phases cross owning Desktop IPC: `not-recorded`, `running`, `observed`, `uncertain`. `not-recorded` means this Agent process has no matching job **in memory**; it does NOT prove absence of an original persisted Stage, key or Writer Claim after a crash/restart.
- A positive `observed` requires the previously completed original first-file result with matched Source, nonzero revision, one verified file, bounded bytes, actual `physical_observed=true`, `backup_complete=false`, `retirement_safe=false` and no worker error. Otherwise a completed job is `uncertain`, never a false success.
- The GET uses the same localhost Agent IPC authentication envelope and a **distinct feature capability**, and returns `Cache-Control: private, no-store`. No local path, file list, request key, original Root ID, Stage, raw error or filesystem digest appears in the DTO.
- Desktop Main/Preload offers an explicit read method; only the verified local Device Backup view receives the adapter. Web/Mobile Web and foreign Desktop receive no inspection or upload authority.

## UI and lifecycle

Opening the first-file dialog reads current own-Agent job status when the new capability exists. A manual '刷新本机任务状态（只读）' action refreshes without re-upload. Pending/running/observed/uncertain states AND failed status GETs cannot trigger an upload in the same dialog; status GET failures require a successful explicit refresh before a first upload button can be used; one attempted POST cannot be repeated in that dialog. Closing the dialog while Agent work continues is allowed; stale responses are fenced by the exact Source and adapter identity. Older Agents without the new capability retain their earlier real manual uploader with its native persistent deny-on-repeat guard, rather than being disabled.

## Explicitly not enabled

No physical CANCEL, remote writer quiescence, immutable SQL terminal INSERT, Stage/key retirement, multi-file, automatic reupload, scheduled SourceRun, Mirror/NAS delete or post-crash durable job result is claimed. Closing the Desktop dialog does **not** certify that the Agent remains running after system shutdown. A missing process job does not authorize a new physical attempt: the pre-existing exact native/Server admission checks remain authoritative.

## Verification and merge rules

Scoped Go tests exercise running/positive/error/unknown, account/session/Server/Source isolation, JSON privacy and no job creation; Node source-contract checks cover Agent GET, transport/capability, stale-source UI, and absence of Web write or inspect access. On a complete frozen master, exactly one scoped work commit and fully additive root AGENTS. Require independent exact-head Go Linux/Windows, authentic PostgreSQL API Race, Web/Desktop, rootless/artifacts/installers/images and Final Gate plus fresh clean mergeability before merge. Production-environment safety acceptance is **SKIPPED BY USER (NOT VERIFIED)**; it must never be requested or required for source/CI/PR merge. No installed Agent/Server or real 4GiB/100k deployment result is asserted.
