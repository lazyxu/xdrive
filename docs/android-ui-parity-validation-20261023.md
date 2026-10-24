# Android native UI validation — 2026-10-24

The first client increment now reuses the canonical xDrive brand, resolved shared
MUI auth palette, exact Rounded MUI action/file glyphs and common filename
classification. Phone folders use the actual PWA iOS-style blue folder paths,
strokes and gradients. Flat mobile list colors, 68dp rows and aligned icon slots
follow `web/src/MobileFiles.tsx`. Native text rendering and 48dp touch controls
remain Android-specific.

Local verification used JDK21, Gradle8.11.1, SDK35 and an isolated API36 emulator.
All temporary data and child-process TEMP/TMP/TMPDIR were on the task's D: path.

| Check | Result |
| --- | --- |
| Generator behavior / source drift / derived vectors | 22 tests passed; `--check` passed |
| Core HTTP + controller + filename JVM tests | 26 tests passed |
| Compose interaction and synthetic visual fixtures | 14 tests passed |
| Actual emulator landscape login/files fixtures | 2 tests passed |
| Android lint, application and instrumentation APKs | Build succeeded; no lint errors |
| Existing CI contract tests | Passed; other CI gates retained |

The new tests first exposed missing controls/layout. Final interaction coverage
includes confirmation mismatch rejection, real password text-layout visibility
and blur/empty reset, logout, retry with retained rows, paging, dark-card color,
dark-file-title pixels and narrow large-font brand/submit reachability. A visual
inspection found black inherited text on the custom dark mobile surface; a test
sampling the unmerged title region failed before explicit content colors fixed
it, then the full suite passed.

Synthetic captures cover light/dark login and files, a280dp/1.5font-scale form,
a short viewport, actual landscape and the PackageManager adaptive launcher mask.
They are compared with original shared React and PWA-folder/row fixtures. These
are controlled component/emulator checks, not physical-device or live production
Server acceptance. Production FLAG_SECURE, memory-only tokens, HTTP opt-in and
backup exclusions remain. Upload, Gallery and album backup are later increments.

The only lint advisories are the existing targetAPI35 and missing monochrome
launcher icon. No suppression or toolchain/dependency change was added. The
canonical Web/Desktop/Server code and cumulative AGENTS history are untouched.

The output is a debug-signed0.1.1 APK. Its isolated debug certificate differs
from the previous0.1.0 local artifact; uninstall that test build before installing
this one. This removes its saved Server address/HTTP preference. GitHub CI also
uses its own debug key; neither artifact is a production update channel.
