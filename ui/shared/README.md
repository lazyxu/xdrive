# xDrive shared UI

`ui/shared` contains presentation-layer contracts and pure helpers that are safe to reuse from both the Web UI and the future Electron renderer.

Keep platform and transport ownership outside this directory. In particular:

- refresh/access-token session models stay in the Web transport or Go agent/core;
- desktop credential storage stays in the existing Go secret-store layer;
- resumable-upload protocol state stays with the transport implementation;
- CfAPI/FUSE, filesystem, process, and Electron IPC code do not belong here.

This keeps the shared renderer-facing surface independent from Web authentication details and from desktop system integration.

External Source UI contracts also live here. Web and Desktop renderer code should reuse the shared Source/Run/Credential models plus the pure label/state/trigger helpers rather than reimplementing connector status rules. Transport ownership still stays outside this directory: Web REST, Electron IPC, xdrive-agent, and credential persistence remain platform-specific.
