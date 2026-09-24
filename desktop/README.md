# xDrive Desktop

xDrive Desktop is the graphical client for the headless Go `xdrive-agent`.

## Responsibilities

- Electron main window, single-instance lifecycle, system tray, desktop notifications, and login-time background startup;
- Electron Main reads `desktop-ipc.json`, owns the local bearer token, performs the Agent protocol handshake, and performs all Agent HTTP requests;
- the sandboxed renderer receives only narrow business operations through preload/`contextBridge`;
- login, required password change, logout, live sync state, pause/resume, sync-now, open-folder, mount/cache settings, conflict resolution;
- Windows file availability controls: always-local, free-space, online-only, and manual sync;
- selective-sync rule management;
- automatic Agent start/recovery plus an explicit Restart Agent action;
- Windows NSIS and Linux DEB desktop packaging.

The renderer never receives the Agent IPC URL/token or xDrive access/refresh tokens. Authentication, DPAPI/Secret Service credentials, CfAPI/FUSE, synchronization, and update ownership remain in the Go core.

The core and desktop packages are still distributed separately. On Windows, `xDriveSetup-amd64.exe` installs the headless background agent plus the retained `xd` CLI; `xDriveDesktopSetup-amd64.exe` installs the Electron UI. On Linux, the corresponding packages are `xdrive-client-linux-amd64.deb` and `xdrive-desktop-linux-amd64.deb`.

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

A background launch keeps the main window hidden while the Tray and Agent monitor run. Desktop first negotiates `GET /v1/hello` and validates the protocol range. If no Agent is available, Desktop starts the installed Core Agent and waits for it to publish Desktop IPC. Unexpected Agent exits are recovered automatically.

The Core Agent remains independent from Electron: quitting Electron does not stop synchronization. The lifecycle shutdown endpoint exists for explicit Agent restart and future atomic upgrade orchestration.
