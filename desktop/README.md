# xDrive Desktop

xDrive Desktop is the graphical client for the headless Go `xdrive-agent`.

## Responsibilities

- Electron main window, single-instance lifecycle, system tray, desktop notifications, and login-time background startup;
- Electron Main reads `desktop-ipc.json`, owns the local bearer token, performs the Agent protocol handshake, and performs all Agent HTTP requests;
- the sandboxed renderer receives only narrow business operations through preload/`contextBridge`;
- login, required password change, logout, live sync state, pause/resume, sync-now, open-folder, mount/cache settings, conflict resolution;
- transfer center for active/completed/failed uploads, downloads, hydration and cache release, including progress/rates/errors and safe retry where the Agent marks a task retryable;
- diagnostics page backed by the same Go checks as `xd doctor`, with redacted PASS/WARN/FAIL results, Agent restart, serialized reconnect, Windows sync-root repair, log-folder access, and report export;
- cloud-folder storage tree with three policy states: Default, Not synced on this device, and Always keep;
- Windows persistent-cache telemetry (used / limit / reclaimable / pinned) plus one-click safe cache release;
- automatic Agent start/recovery plus an explicit Restart Agent action;
- Windows NSIS and Linux DEB desktop packaging.

The renderer never receives the Agent IPC URL/token or xDrive access/refresh tokens. Authentication, DPAPI/Secret Service credentials, CfAPI/FUSE, synchronization, and update ownership remain in the Go core.

The primary client packages are now unified. On Windows, `xDriveSetup-amd64.exe` installs Electron Desktop, the headless Agent, and `xd` together. On Linux, `xdrive-client-linux-amd64.deb` contains the same complete client stack. The standalone Desktop installer assets remain temporarily available for transition/testing compatibility, but normal installation and `xd update` use the unified packages.

## Development

```bash
cd desktop
npm install --no-audit --no-fund
npm run test:main
npm run build
npm start
```


## Desktop / Agent lifecycle

Packaged Desktop builds default to **Start xDrive Desktop at login**. Windows uses the per-user login item with `--background`; Linux writes a per-user XDG autostart entry. The preference is editable in Desktop Settings.

A background launch keeps the main window hidden while the Tray and Agent monitor run. Transfer progress uses a separate Agent long-poll revision stream, so high-frequency byte progress does not churn the general sync/account status monitor. Diagnostics and self-repair remain behind Electron Main: the renderer never receives the Agent discovery token and does not execute platform commands directly. Desktop first negotiates `GET /v1/hello` and validates the protocol range. If no Agent is available, Desktop starts the installed Core Agent and waits for it to publish Desktop IPC. Unexpected Agent exits are recovered automatically.

The Core Agent remains independent from Electron: quitting Electron does not stop synchronization. The lifecycle shutdown endpoint exists for explicit Agent restart and future atomic upgrade orchestration.
