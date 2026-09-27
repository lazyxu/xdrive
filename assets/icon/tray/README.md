# xDrive tray/status icons

These five 16 × 16 PNG files are the canonical operational tray assets used by xDrive Desktop:

- normal
- syncing
- paused
- conflict
- offline

They intentionally remain separate from `../master/xdrive-icon-master.svg`: the master SVG is the application brand icon, while these images communicate runtime state at very small sizes.

Electron Builder copies this directory to `resources/tray-icons/` in packaged builds. Do not duplicate the image bytes in TypeScript or platform packaging folders.
