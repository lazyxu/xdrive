# xDrive Desktop

Phase 2 introduces the Electron desktop shell only. It deliberately does **not** connect to `xdrive-agent`, authenticate users, mount storage, or perform sync.

## Responsibilities in this phase

- Electron main window and single-instance behavior;
- system tray with Open and Quit actions;
- minimize/close-to-tray lifecycle;
- sandboxed renderer with `contextIsolation`, `nodeIntegration: false`, and a narrow preload `contextBridge`;
- React renderer consuming `ui/shared`;
- Windows NSIS and Linux DEB packaging as standalone `xdrive-desktop` artifacts.

The existing `xd`, `xdrive-agent`, Windows client installer, and Linux client package remain unchanged and continue to ship separately.

## Development

```bash
cd desktop
npm install --no-audit --no-fund
npm run build
npm start
```

For renderer-only development, run Vite and launch Electron with `XD_DESKTOP_DEV_URL=http://127.0.0.1:5174` after compiling the main/preload scripts.
