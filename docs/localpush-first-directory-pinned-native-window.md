# L03-F2d8c3b2s — private pinned CURRENT directory read window

**Status:** bounded owning-Agent/localpush read hardening on top of merged #1913. No production Local Push executor or feature activation.

## Implemented scope

- During the existing owning-only first-directory CURRENT recheck, keep an open OS directory handle while streaming and validating the complete sealed inventory, two native identity observations and the stored Root grant.
- Require pre-open Lstat, open-handle Stat and path identity to agree via os.SameFile; reject symlinks, missing paths and a same-name replacement observed before the read returns. The handle is closed on all outcomes.
- Add Linux/Windows physical temporary-directory tests: the observed path initially matches the pinned handle; Linux rename-and-replace fails the pinned-match check, while Windows refusal to rename an open directory is accepted as its OS-level sharing fence.
- Extend the Desktop source contract to keep the native seal and new handle checks unexposed through Server Router, Go Client, Agent IPC, Electron Main/Preload and Web.

## Deliberate limitations and follow-up

The handle is held **only inside the local Agent's private observation** and is closed before any Server nonce consumption. It cannot prove that a pathname was continuously stable (including A-B-A substitution), cannot transmit a native OS handle across machines, and is not atomic with PostgreSQL or CAS writes. The HMAC and durable one-use challenge therefore remain **advisory**. Neither passing the pin check nor consuming a challenge may create a Node/SourceItem/FileVersion, mark a SourceRun complete, infer Mirror missing files, or permit uploads.

Production local_folder execution/start/cancel, recursive and crash-safe backup, native-to-SQL lifetime protocol, >=4 GiB and physical installed 100k acceptance remain blocked. Web/Mobile Web/foreign Desktop remain read-only, NAS Push unsupported, private Stage cap <=64 MiB and existing Pull flows unchanged.

## Merge acceptance

One frozen-master parent and **exactly one work commit**. Run full exact-HEAD GitHub Go Linux/API real PostgreSQL Race, Windows, Web/Desktop, images/artifacts, single-commit and final-gate before Ready/Rebase merge; then verify the related branch cleanup. Tests of an OS handle inside one process are **not** proof of crash-safe, multi-host, cross-process source provenance. No physical installed Desktop or GitLab delivery is claimed.
