# Shared native design derivatives

Canonical inputs are `ui/shared/src/mui/theme.ts`, the extension/classification
and non-folder glyph helpers of `FileExplorerItemPresentation.tsx`, plus the
mobile blue folder and consumed page/row surface colors of
`web/src/MobileFiles.tsx`. The phone uses the user's chosen PWA iOS-style folder,
not the Desktop yellow folder. Unrelated Explorer/MobileFiles layout is not
fingerprinted.
`shared-ui.json` records the resolved MUI palette (not legacy CSS tokens), input
fingerprints and locked package metadata. Android does not use dynamic colors.

`material-rounded-icons.json` contains only the 17 used glyphs from
`@mui/icons-material` 7.3.11, their exact SVG paths and original JS SHA-256.
The generator verifies the npm archive against `web/package-lock.json` SHA-512,
then byte-compares every selected installed JS and the MIT license to that
archive before generating. `MUI-LICENSE.txt` preserves the upstream notice.
Upstream: https://github.com/mui/material-ui/tree/v7.3.11/packages/mui-icons-material

Run `node android/scripts/shared-ui.mjs --check` and
`node --test android/scripts/shared-ui.test.mjs` without npm dependencies.
Regenerate with `node android/scripts/shared-ui.mjs --write` using the matching
TypeScript/MUI packages under `desktop/node_modules`. An alternate existing
read-only package directory is accepted via `XDRIVE_UI_NODE_MODULES`; an existing
download of the locked icons archive is accepted via `XDRIVE_MUI_ICONS_ARCHIVE`.
Archive integrity checks are identical for local and network inputs. Regeneration
must never modify the canonical sources. Set TEMP/TMP/TMPDIR to the task's D:
temporary directory before launching these commands.

`xd_folder.xml` is derived from xDrive's own `MobileFolderIcon` SVG, not a MUI
shape recolored blue or an Apple asset. It preserves the 64x54 viewport, both
filled/stroked paths and highlight path. The SVG objectBoundingBox vertical
gradients map to the fill geometry's actual y bounds: back 8..46.5, front
18.5..51, retaining the front's 26% middle stop. Stroke width 0.75, highlight
width 1.1 / alpha 0.95 and round highlight caps are preserved. Geometry/gradient
structure is deliberately pinned: unsupported SVG changes require reviewing the
bounds conversion rather than silently guessing. Colors are extracted literals.
Compose renders the folder with no tint at 38x32.0625dp in a centered 40dp slot;
all other file glyphs remain 24dp. Mobile page white/black and row white/#1c1c1e
colors are generated separately from the unchanged auth/MUI theme palette.

The brand is copied at build time from `assets/icon/web/pwa-512.png` with declared
Gradle inputs/outputs. In-app display uses the master 242/1024 corner ratio.
The launcher inset compensates for the Android adaptive layer expansion; actual
launcher mask rendering still requires device/emulator visual verification.
