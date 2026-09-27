# xDrive tray/status icons

These five 16 × 16 PNG files are generated operational variants of `../master/xdrive-icon-master.svg`:

- normal
- syncing
- paused
- conflict
- offline

The application master remains the single source of truth. `scripts/generate-icon-assets.mjs` renders the master at tray scale and adds only a small status badge for the non-normal states. Do not hand-edit these PNGs; run `make icons` after changing the master or the tray variant rules.

Electron Builder copies this directory to `resources/tray-icons/` in packaged builds. Development builds read the same generated files directly from `assets/icon/tray/`.
