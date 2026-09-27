# xDrive application icon

`assets/icon/master/xdrive-icon-master.svg` is the single source of truth for the xDrive application icon.

## Usage

- Web: generated derivatives live in `assets/icon/web/` — SVG/ICO favicon, Apple Touch 180 px, PWA 192 px and PWA 512 px. In-app Web brand lockups import the master SVG directly.
- Electron Desktop (Windows/Linux): electron-builder consumes the master SVG directly and generates the platform icon set; renderer brand lockups import the same master SVG.
- Linux DEB: installs the master SVG as `hicolor/scalable/apps/xdrive.svg`.
- Windows Inno Setup: uses `assets/icon/windows/app.ico`, a generated derivative of the master SVG.
- Tray/status icons are operational state assets and remain separate from the main application icon.

## Rules

Do not hand-edit generated platform or Web icon files. Update the master SVG first, then regenerate derivatives.

Current Windows `app.ico` contains 16, 32, 48, 64, and 256 px frames. Every generated frame must fit completely inside the ICO file; CI rejects truncated derivatives.

Current Web derivatives are:

- `favicon.svg`: exact SVG derivative of the master;
- `favicon.ico`: 16, 32 and 48 px frames;
- `apple-touch-icon.png`: 180 × 180;
- `pwa-192.png`: 192 × 192;
- `pwa-512.png`: 512 × 512;
- `site.webmanifest`: references the 192 and 512 PNGs and the shared xDrive theme color.

The approved master canvas is 1024 × 1024 with a 1024 × 1024 SVG viewBox.
