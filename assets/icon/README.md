# xDrive application icon

`assets/icon/master/xdrive-icon-master.svg` is the single source of truth for the xDrive application icon.

## Usage

- Web: generated derivatives live in `assets/icon/web/` — SVG/ICO favicon, Apple Touch 180 px, PWA 192 px and PWA 512 px. In-app Web brand lockups import the master SVG directly. **Apple Touch/PWA PNGs are rendered from a temporary fully opaque square background** because iOS/Android supply their own launcher masks; the master SVG and desktop/ICO/tray derivatives retain the brand's rounded silhouette.
- Electron Desktop: Linux consumes the master SVG directly. Windows uses the generated multi-size `assets/icon/windows/app.ico` for both the executable and runtime taskbar/window icon so Explorer can re-resolve the icon reliably while taskbar progress/overlay state changes. Renderer brand lockups still import the same master SVG.
- Linux DEB: installs the master SVG as `hicolor/scalable/apps/xdrive.svg`.
- Windows Inno Setup: uses `assets/icon/windows/app.ico`, a generated derivative of the master SVG.
- Tray/status icons are master-derived operational variants. The generator renders the approved master at tray scale and overlays small state badges; their canonical PNGs live in `assets/icon/tray/` and are copied into packaged Electron resources.

## Rules

Do not hand-edit generated platform or Web icon files. Update the master SVG first, then regenerate derivatives.

## Regenerate derivatives

Run `make icons` from the repository root (or `node scripts/generate-icon-assets.mjs`). The generator prefers Inkscape, then `rsvg-convert`, then ImageMagick `magick`; set `XDRIVE_ICON_RENDERER` to force a renderer on PATH.

The generator also rewrites `assets/icon/generated-assets.json`. This machine-readable contract stores the Git blob SHA of the approved master plus every generated Web/Windows derivative. Desktop CI recomputes those hashes, so changing the master or any generated derivative without running `make icons` fails immediately.

The approved master is never rewritten. For rasterization only, the generator expands the current `feDropShadow` into equivalent SVG filter primitives in a temporary file so older renderers do not lose the xDrive mark. It then regenerates the Web favicon/PWA assets and Windows `app.ico` in one pass.

Current Windows `app.ico` contains 16, 32, 48, 64, and 256 px frames. Every generated frame must fit completely inside the ICO file; CI rejects truncated derivatives.

Current Web derivatives are:

- `favicon.svg`: exact SVG derivative of the master;
- `favicon.ico`: 16, 32 and 48 px frames;
- `apple-touch-icon.png`: 180 × 180;
- `pwa-192.png`: 192 × 192;
- `pwa-512.png`: 512 × 512;
- `site.webmanifest`: references the 192 and 512 PNGs, shared xDrive theme color, and the stable root install identity (`id`, `start_url`, `scope`) used by the mobile Web app.

The approved master canvas is 1024 × 1024 with a 1024 × 1024 SVG viewBox. Both blue rounded background rectangles span the full `(0,0) → (1024,1024)` canvas (no 48 px transparent inset), and the original x/infinity symbol is enlarged uniformly 8%. The generator temporarily omits only the `rx` attribute for the Apple Touch/PWA exports so **every launcher PNG pixel is opaque**; the Web icon checker reconstructs PNG alpha to reject transparent margins. The manifest declares the launcher PNGs `any maskable`.

**Updating an installed iOS PWA:** Safari/iOS may cache a Home Screen icon across website deployments. After deploying new Web assets, remove the old Home Screen shortcut and add xDrive to the Home Screen again to force a fresh Apple Touch icon. This is an icon-cache operation, not a Server restart or file/data reset.

## Tray/status icons

The tray uses five 16 × 16 PNG state assets:

- `tray-normal.png`
- `tray-syncing.png`
- `tray-paused.png`
- `tray-conflict.png`
- `tray-offline.png`

These are generated derivatives of the brand master SVG with small operational state badges. Do not hand-edit them. Electron packages them under `resources/tray-icons/`; development builds read the same generated files directly from `assets/icon/tray/`.
