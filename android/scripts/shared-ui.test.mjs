import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let generator;
try { generator = await import('./shared-ui.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
test('canonical generator is available', () => assert.ok(generator, 'missing canonical native asset generator'));
if (generator) {
  const { verify, sourcePaths, outputPaths, parseIcon } = generator;
  function fixture(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-ui-'));
    try {
      for (const relative of new Set([...sourcePaths, 'web/src/MobileFiles.tsx', ...outputPaths(root)])) {
        const dest = path.join(dir, relative);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(root, relative), dest);
      }
      run(dir);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  test('checked-in assets verify without MUI dependencies', () => fixture(dir => assert.doesNotThrow(() => verify(dir))));
  test('missing Kotlin output fails verification', () => fixture(dir => {
    fs.unlinkSync(path.join(dir, 'android/app/src/main/java/com/tfluid/xdrive/SharedVisuals.kt'));
    assert.throws(() => verify(dir), /missing|ENOENT/);
  }));
  for (const [title, relative, before, after] of [
    ['palette drift', 'ui/shared/src/mui/theme.ts', '#4177e6', '#123456'],
    ['extension drift', 'ui/shared/src/mui/FileExplorerItemPresentation.tsx', "'arw'", "'newext'"],
    ['classification drift', 'ui/shared/src/mui/FileExplorerItemPresentation.tsx', "dot <= 0", "dot < 0"],
    ['package version drift', 'web/package-lock.json', '"7.3.11"', '"99.0.0"'],
    ['modified vector', 'android/app/src/main/res/drawable/xd_image.xml', '#FF000000', '#FFFFFFFF'],
  ]) test(title + ' fails verification', () => fixture(dir => {
    const target = path.join(dir, relative);
    const original = fs.readFileSync(target, 'utf8');
    assert.ok(original.includes(before));
    fs.writeFileSync(target, original.replaceAll(before, after));
    assert.throws(() => verify(dir), /drift|changed|unsupported/);
  }));
  test('invalid extension source fails closed', () => fixture(dir => {
    const target = path.join(dir, 'ui/shared/src/mui/FileExplorerItemPresentation.tsx');
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace("new Set(['arw'", "new Set([compute()"));
    assert.throws(() => verify(dir), /unsupported/);
  }));
  test('unsupported SVG nodes are rejected', () => {
    assert.throws(() => parseIcon('(0, _jsxRuntime.jsx)("circle", { r: 3 })', 'CircleRounded'), /unsupported/);
  });
  test('unrelated Explorer layout changes do not invalidate assets', () => fixture(dir => {
    const target = path.join(dir, 'ui/shared/src/mui/FileExplorerItemPresentation.tsx');
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('minHeight: 32', 'minHeight: 40'));
    assert.doesNotThrow(() => verify(dir));
  }));
  test('flat MUI multi-path glyphs preserve both shapes', () => {
    const source = `_createSvgIcon.default)([(0, _jsxRuntime.jsx)("path", { d: "M0 0h2v2z" }, "0"), (0, _jsxRuntime.jsx)("path", { d: "M3 3h2v2z" }, "1")], 'ExampleRounded');`;
    assert.deepEqual(parseIcon(source, 'ExampleRounded'), ['M0 0h2v2z', 'M3 3h2v2z']);
    assert.throws(() => parseIcon(source.replace('d: "M0', 'opacity: 0.5, d: "M0'), 'ExampleRounded'), /unsupported/);
  });
  for (const [title, before, after] of [
    ['mobile folder path', 'M6 8h15', 'M7 8h15'],
    ['mobile folder blue', "const BLUE_FOLDER = '#4caddb'", "const BLUE_FOLDER = '#123456'"],
    ['mobile folder gradient stop', 'offset="26%"', 'offset="28%"'],
    ['mobile folder stroke', 'strokeWidth="0.75"', 'strokeWidth="0.85"'],
    ['mobile row surface', "'#1c1c1e'", "'#1d1d1f'"],
    ['mobile page surface', "'#000000'", "'#010101'"],
  ]) test(title + ' drift fails verification', () => fixture(dir => {
    const target = path.join(dir, 'web/src/MobileFiles.tsx');
    const source = fs.readFileSync(target, 'utf8');
    assert.ok(source.includes(before));
    fs.writeFileSync(target, source.replaceAll(before, after));
    assert.throws(() => verify(dir), /unsupported|drift|changed/);
  }));
  test('folder output preserves mobile objectBoundingBox gradients and highlight', () => {
    const vector = fs.readFileSync(path.join(root, 'android/app/src/main/res/drawable/xd_folder.xml'), 'utf8');
    assert.match(vector, /android:viewportWidth="64"/);
    assert.match(vector, /android:startY="8" android:endX="0" android:endY="46.5"/);
    assert.match(vector, /android:startY="18.5" android:endX="0" android:endY="51"/);
    assert.match(vector, /android:offset="0.26"/);
    assert.match(vector, /android:strokeAlpha="0.95" android:strokeLineCap="round"/);
  });
  test('unrelated MobileFiles behavior does not invalidate assets', () => fixture(dir => {
    const target = path.join(dir, 'web/src/MobileFiles.tsx');
    const source = fs.readFileSync(target, 'utf8');
    const layout = "minHeight: 0, minWidth: 0, height: '100%', flex: 1";
    assert.ok(source.includes(layout));
    fs.writeFileSync(target, source.replace(layout, layout.replace('flex: 1', 'flex: 2')));
    assert.doesNotThrow(() => verify(dir));
  }));
  test('mobile folder generated gradient tampering fails verification', () => fixture(dir => {
    const target = path.join(dir, 'android/app/src/main/res/drawable/xd_folder.xml');
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('android:endY="46.5"', 'android:endY="54"'));
    assert.throws(() => verify(dir), /changed/);
  }));
  test('directory-only row color drift fails verification', () => fixture(dir => {
    const target = path.join(dir, 'web/src/MobileFiles.tsx');
    const source = fs.readFileSync(target, 'utf8');
    const expression = "effectiveGrid ? 'transparent' : (theme => theme.palette.mode === 'dark' ? '#1c1c1e' : '#ffffff')";
    assert.ok(source.includes(expression));
    fs.writeFileSync(target, source.replace(expression, expression.replace('#1c1c1e', '#1d1d1f')));
    assert.throws(() => verify(dir), /unsupported|drift|changed/);
  }));
}
