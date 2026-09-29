# xDrive shared UI

`ui/shared` contains presentation-layer contracts and pure helpers that are safe to reuse from both the Web UI and the future Electron renderer.

Keep platform and transport ownership outside this directory. In particular:

- refresh/access-token session models stay in the Web transport or Go agent/core;
- desktop credential storage stays in the existing Go secret-store layer;
- resumable-upload protocol state stays with the transport implementation;
- CfAPI/FUSE, filesystem, process, and Electron IPC code do not belong here.

This keeps the shared renderer-facing surface independent from Web authentication details and from desktop system integration.

External Source UI contracts also live here. Web and Desktop renderer code should reuse the shared Source/Run/Credential models plus the pure label/state/trigger helpers rather than reimplementing connector status rules. Transport ownership still stays outside this directory: Web REST, Electron IPC, xdrive-agent, and credential persistence remain platform-specific.


## Shared MUI renderer components

Reusable React/MUI primitives that are safe in both Web and Electron renderer code live under `src/mui` and are exposed through `@xdrive/ui/mui`.

Keep this renderer-only entry separate from the pure `src/index.ts` contracts. Electron main/preload and other Node-only code must continue to use the pure helpers without importing React or MUI.

The renderer-only shared entry also owns cross-client dialog primitives and the Synology DSM guide dialog so Web and Desktop do not maintain parallel copies of the same MUI flow.
