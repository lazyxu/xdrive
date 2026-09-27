# xDrive application icon

`assets/icon/master/xdrive-icon-master.svg` is the single source of truth for the xDrive application icon.

## Usage

- Web favicon: Vite serves the master SVG directly.
- Electron Desktop (Windows/Linux): electron-builder consumes the master SVG directly and generates the platform icon set.
- Linux DEB: installs the master SVG as `hicolor/scalable/apps/xdrive.svg`.
- Windows Inno Setup: uses `assets/icon/windows/app.ico`, a generated derivative of the master SVG.
- Tray/status icons are operational state assets and remain separate from the main application icon.

## Rules

Do not hand-edit generated platform icon files. Update the master SVG first, then regenerate derivatives.

Current Windows `app.ico` contains 16, 32, 48, 64, and 256 px frames. Every generated frame must fit completely inside the ICO file; CI rejects truncated derivatives.

The approved master canvas is 1024 × 1024 with a 1024 × 1024 SVG viewBox.
