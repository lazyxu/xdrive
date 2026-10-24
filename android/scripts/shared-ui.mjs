// Native derivatives of the existing Web/Desktop design. --check uses Node builtins only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const kotlinPath = 'android/app/src/main/java/com/tfluid/xdrive/SharedVisuals.kt';
const snapshotPath = 'android/design/shared-ui.json';
const iconsPath = 'android/design/material-rounded-icons.json';
const licensePath = 'android/design/MUI-LICENSE.txt';
export const sourcePaths = ['ui/shared/src/mui/theme.ts', 'ui/shared/src/mui/FileExplorerItemPresentation.tsx', 'web/src/MobileFiles.tsx', 'web/package-lock.json'];
const glyphs = {
  arrow_back: 'ArrowBack', refresh: 'Refresh', more_vert: 'MoreVert',
  visibility: 'Visibility', visibility_off: 'VisibilityOff', logout: 'Logout', settings: 'Settings',
  image: 'Image', movie: 'Movie', audio_file: 'AudioFile', picture_as_pdf: 'PictureAsPdf',
  table_chart: 'TableChart', view_carousel: 'ViewCarousel', folder_zip: 'FolderZip', description: 'Description', code: 'Code', insert_drive_file: 'InsertDriveFile',
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = (base, name) => {
  const value = fs.readFileSync(path.join(base, name), 'utf8').replaceAll('\r\n', '\n');
  if (value.length > 2_000_000) throw new Error(`unsupported source size: ${name}`);
  return value;
};
const json = value => JSON.stringify(value, null, 2) + '\n';
function one(source, regex, label) {
  const matches = [...source.matchAll(regex)];
  if (matches.length !== 1) throw new Error(`unsupported ${label}`);
  return matches[0][0];
}
export function extractInputs(base) {
  const [theme, presentation, mobile] = sourcePaths.slice(0, 3).map(name => read(base, name));
  const sets = {};
  const definitions = [...presentation.matchAll(/const (\w+)Extensions = new Set\(\[([\s\S]*?)\]\)/g)];
  if (definitions.length !== 9) throw new Error('unsupported extension sets');
  for (const [, kind, contents] of definitions) {
    if (!/^(?:\s*'[a-z0-9]+'\s*,?\s*)+$/.test(contents)) throw new Error('unsupported extension literal');
    sets[kind] = [...contents.matchAll(/'([a-z0-9]+)'/g)].map(match => match[1]);
    if (new Set(sets[kind]).size !== sets[kind].length) throw new Error('unsupported duplicate extension');
  }
  if (Object.keys(sets).sort().join(',') !== 'archive,audio,code,document,image,presentation,spreadsheet,text,video') throw new Error('unsupported extension categories');
  const extension = one(presentation, /function explorerExtension\(name: string\) \{[\s\S]*?\n\}/g, 'extension function');
  const classifier = one(presentation, /export function xDriveFileKind\([^\n]+\)[:\w ]*\{[\s\S]*?\n\}/g, 'classifier function');
  const iconMapping = one(presentation, /export function XDriveFileExplorerItemIcon\([\s\S]*?\n\}/g, 'icon mapping');
  // The Kotlin adapter implements these bounded helper semantics. A changed
  // classifier or icon decision tree needs an explicit adapter update, rather
  // than silently blessing incompatible Kotlin by refreshing fingerprints.
  const supported = {
    extension: 'caf328b557e5c02d2c33f276fc03cb4dc31c25bf77f7b9c5e1ea7a93cc07c9f9',
    classifier: '11068264ca1257fdea19fa3096bc22a0273191709cb54d3348b41efc5b7c8654',
    iconMapping: '761e51bdc44cab2f8615daf7bac4dc7253b32879ed8e9ffe1e471797f485a16d',
  };
  for (const [name, source] of Object.entries({ extension, classifier, iconMapping })) {
    if (hash(source.replace(/\s+/g, '')) !== supported[name]) throw new Error(`unsupported ${name} semantics: update native adapter`);
  }
  const mobileDesign = extractMobileDesign(mobile);
  const themeFunction = one(theme, /export function createXDriveMuiTheme\([\s\S]*\n\}/g, 'theme function');
  // Pin only consumed helpers/functions, not unrelated Explorer layout code.
  const fingerprints = {
    theme: hash(themeFunction), extensions: hash(json(sets)), extension: hash(extension),
    classifier: hash(classifier), iconMapping: hash(iconMapping), mobile: hash(json(mobileDesign)),
  };
  const lock = JSON.parse(read(base, sourcePaths[3]));
  const packages = {};
  for (const name of ['@mui/icons-material', '@mui/material']) {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry || !/^\d+\.\d+\.\d+$/.test(entry.version) || !/^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity)) throw new Error('unsupported package lock');
    packages[name] = { version: entry.version, integrity: entry.integrity, resolved: entry.resolved };
  }
  return { fingerprints, sets, mobileDesign, packages, theme };
}
export function extractMobileDesign(source) {
  const component = one(source, /function MobileFolderIcon\([\s\S]*?\n\}/g, 'mobile folder');
  const geometrySha256 = hash(component.replace(/\s+/g, ''));
  // These SVG objectBoundingBox gradients use the actual path fill bounds.
  // A new geometry needs a reviewed bounds mapping, never a guessed gradient.
  if (geometrySha256 !== 'd2d9fc95f89131d59cc81dc76b16343b184ed9ddab1287b10bd93b9b84deabde') throw new Error('unsupported mobile folder geometry/gradient structure');
  const colors = {};
  const block = one(source, /const IOS_FILES_ICON_COLORS = \{[\s\S]*?\n\} as const/g, 'mobile colors');
  for (const name of ['folderBackTop', 'folderBackBottom', 'folderFrontTop', 'folderFrontMiddle', 'folderOutline', 'folderHighlight']) {
    const match = block.match(new RegExp(`\\b${name}: '(#[a-fA-F0-9]{6})'`));
    if (!match) throw new Error(`unsupported mobile color: ${name}`);
    colors[name] = match[1];
  }
  colors.folderFrontBottom = one(source, /const BLUE_FOLDER = '#[a-fA-F0-9]{6}'/g, 'mobile blue').match(/#[a-fA-F0-9]+/)[0];
  const paths = [...component.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
  const colorExpression = "bgcolor: theme => theme\\.palette\\.mode === 'dark' \\? '(#[a-fA-F0-9]{6})' : '(#[a-fA-F0-9]{6})'";
  const page = source.match(new RegExp('data-xdrive-mobile-files[\\s\\S]{0,500}?' + colorExpression));
  const directorySurface = one(source, /effectiveGrid \? 'transparent' : \(theme => theme\.palette\.mode === 'dark' \? '#[a-fA-F0-9]{6}' : '#[a-fA-F0-9]{6}'\)/g, 'mobile directory surface');
  const row = directorySurface.match(/'dark' \? '(#[a-fA-F0-9]{6})' : '(#[a-fA-F0-9]{6})'/);
  if (!page || !row) throw new Error('unsupported mobile surface structure');
  return { geometrySha256, paths, colors, surfaces: { lightMobilePage: page[2], darkMobilePage: page[1], lightMobileRow: row[2], darkMobileRow: row[1] } };
}
function mobileFolderVector(mobile) {
  const c = mobile.colors;
  const path = (index, start, end, stops) => `    <path android:pathData="${mobile.paths[index]}" android:strokeColor="${c.folderOutline}" android:strokeWidth="0.75">\n        <aapt:attr name="android:fillColor">\n            <gradient android:type="linear" android:startX="0" android:startY="${start}" android:endX="0" android:endY="${end}" android:tileMode="clamp">\n${stops.map(([offset, color]) => `                <item android:offset="${offset}" android:color="${color}" />`).join('\n')}\n            </gradient>\n        </aapt:attr>\n    </path>`;
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated from xDrive's own PWA MobileFolderIcon; see android/design. -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="38dp" android:height="32.0625dp" android:viewportWidth="64" android:viewportHeight="54">\n${path(0, 8, 46.5, [[0, c.folderBackTop], [1, c.folderBackBottom]])}\n${path(1, 18.5, 51, [[0, c.folderFrontTop], [0.26, c.folderFrontMiddle], [1, c.folderFrontBottom]])}\n    <path android:pathData="${mobile.paths[2]}" android:fillColor="#00000000" android:strokeColor="${c.folderHighlight}" android:strokeWidth="1.1" android:strokeAlpha="0.95" android:strokeLineCap="round" />\n</vector>\n`;
}
export function parseIcon(source, name) {
  // Allow only a path or a flat array of paths, preserving separate paths.
  // Reject transforms, groups, opacity, additional props and custom viewboxes.
  const call = source.match(/_createSvgIcon\.default\)\(([\s\S]+), '([A-Za-z]+Rounded)'\);\s*$/);
  if (!call || call[2] !== name) throw new Error(`unsupported SVG node: ${name}`);
  const expression = call[1].replaceAll('/*#__PURE__*/', '');
  const pathNode = /\(0, _jsxRuntime\.jsx\)\("path", \{\s*d: "([MmLlHhVvCcSsQqTtAaZz0-9., +\-]+)"\s*\}(?:, "\d+")?\)/g;
  const nodes = [...expression.matchAll(pathNode)];
  if (!nodes.length || nodes.length > 8 || !/^[\s\[\],]*$/.test(expression.replace(pathNode, ''))) throw new Error(`unsupported SVG node: ${name}`);
  return nodes.map(node => node[1]);
}
function vector(paths, mirror) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated from MIT licensed @mui/icons-material; see android/design. -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"${mirror ? ' android:autoMirrored="true"' : ''}>\n${paths.map(d => `    <path android:fillColor="#FF000000" android:pathData="${d}" />`).join('\n')}\n</vector>\n`;
}
function argb(color) {
  if (/^#[\da-f]{3}$/i.test(color)) color = '#' + [...color.slice(1)].map(c => c + c).join('');
  if (/^#[\da-f]{6}$/i.test(color)) return `0xFF${color.slice(1).toUpperCase()}`;
  const rgba = color.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  if (!rgba) throw new Error(`unsupported palette color: ${color}`);
  return '0x' + [Math.round(Number(rgba[4]) * 255), ...rgba.slice(1, 4).map(Number)].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function outputs(snapshot, icons) {
  const files = {};
  for (const [resource, glyph] of Object.entries(glyphs)) {
    const entry = icons.glyphs[resource];
    if (entry.name !== glyph + 'Rounded' || !Array.isArray(entry.paths) || !entry.paths.length || entry.paths.some(d => !/^[MmLlHhVvCcSsQqTtAaZz0-9., +\-]+$/.test(d))) throw new Error('unsupported glyph snapshot');
    files[`android/app/src/main/res/drawable/xd_${resource}.xml`] = vector(entry.paths, ['arrow_back', 'chevron_right', 'logout'].includes(resource));
  }
  let kt = '// Generated by android/scripts/shared-ui.mjs --write. Do not edit.\npackage com.tfluid.xdrive\n\ninternal object SharedVisuals {\n';
  for (const [mode, palette] of Object.entries(snapshot.palette)) {
    for (const [key, value] of Object.entries(palette)) kt += `    const val ${mode}${key[0].toUpperCase() + key.slice(1)} = ${argb(value)}\n`;
  }
  for (const [name, color] of Object.entries(snapshot.mobileDesign.surfaces)) kt += `    const val ${name} = ${argb(color)}\n`;
  files['android/app/src/main/res/drawable/xd_folder.xml'] = mobileFolderVector(snapshot.mobileDesign);
  for (const [kind, values] of Object.entries(snapshot.sets)) kt += `    val ${kind}Extensions = setOf(${values.map(v => '"' + v + '"').join(', ')})\n`;
  files[kotlinPath] = kt + '}\n';
  return files;
}
export function outputPaths(base) {
  return [snapshotPath, iconsPath, licensePath, kotlinPath, 'android/app/src/main/res/drawable/xd_folder.xml', ...Object.keys(glyphs).map(key => `android/app/src/main/res/drawable/xd_${key}.xml`)];
}
export function verify(base = root) {
  const input = extractInputs(base);
  const snapshot = JSON.parse(read(base, snapshotPath));
  if (json(input.fingerprints) !== json(snapshot.fingerprints) || json(input.packages) !== json(snapshot.packages)) throw new Error('canonical source/package drift: regenerate shared UI');
  if (hash(read(base, iconsPath)) !== snapshot.iconsSha256 || hash(read(base, licensePath)) !== snapshot.licenseSha256) throw new Error('icon provenance changed');
  const icons = JSON.parse(read(base, iconsPath));
  for (const [name, contents] of Object.entries(outputs(snapshot, icons))) {
    if (read(base, name) !== contents) throw new Error(`generated output changed: ${name}`);
  }
  return true;
}
async function authenticatedPackage(entry, wanted) {
  if (!entry.resolved.startsWith('https://registry.npmjs.org/')) throw new Error('unsupported registry');
  let archive;
  if (process.env.XDRIVE_MUI_ICONS_ARCHIVE) archive = fs.readFileSync(process.env.XDRIVE_MUI_ICONS_ARCHIVE);
  else {
    const response = await fetch(entry.resolved, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`registry fetch failed: ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
  }
  if (archive.length > 12_000_000 || 'sha512-' + crypto.createHash('sha512').update(archive).digest('base64') !== entry.integrity) throw new Error('package integrity mismatch');
  const tar = zlib.gunzipSync(archive, { maxOutputLength: 96_000_000 });
  const result = {};
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim() || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('unsupported tar');
    if (wanted.has(name)) result[name] = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  for (const name of wanted) if (!result[name]) throw new Error(`package missing ${name}`);
  return result;
}
async function write(base = root) {
  const input = extractInputs(base);
  const modules = process.env.XDRIVE_UI_NODE_MODULES || path.join(base, 'desktop/node_modules');
  const require = createRequire(path.join(modules, '__xdrive_generator.cjs'));
  const ts = require('typescript');
  const material = JSON.parse(fs.readFileSync(path.join(modules, '@mui/material/package.json')));
  const iconPackage = JSON.parse(fs.readFileSync(path.join(modules, '@mui/icons-material/package.json')));
  if (material.version !== input.packages['@mui/material'].version || iconPackage.version !== input.packages['@mui/icons-material'].version) throw new Error('installed package version drift');
  const wanted = new Set(['package/LICENSE', ...Object.values(glyphs).map(name => `package/${name}Rounded.js`)]);
  const authenticated = await authenticatedPackage(input.packages['@mui/icons-material'], wanted);
  const icons = { package: '@mui/icons-material', ...input.packages['@mui/icons-material'], integrityVerified: true, glyphs: {} };
  for (const [resource, glyph] of Object.entries(glyphs)) {
    const name = glyph + 'Rounded';
    const bytes = fs.readFileSync(path.join(modules, '@mui/icons-material', name + '.js'));
    if (!bytes.equals(authenticated[`package/${name}.js`])) throw new Error(`installed glyph integrity mismatch: ${name}`);
    icons.glyphs[resource] = { name, sourceSha256: hash(bytes), paths: parseIcon(bytes.toString(), name) };
  }
  const license = fs.readFileSync(path.join(modules, '@mui/icons-material/LICENSE'));
  if (!license.equals(authenticated['package/LICENSE'])) throw new Error('license integrity mismatch');
  const code = ts.transpileModule(input.theme, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, require: name => {
    if (name !== '@mui/material/styles') throw new Error('unsupported theme import');
    return require(name);
  } }, { timeout: 5000 });
  const palette = {};
  for (const mode of ['light', 'dark']) {
    const p = module.exports.createXDriveMuiTheme(mode).palette;
    palette[mode] = { primary: p.primary.main, onPrimary: p.primary.contrastText, background: p.background.default, surface: p.background.paper, text: p.text.primary, secondaryText: p.text.secondary, divider: p.divider, error: p.error.main };
  }
  const snapshot = { fingerprints: input.fingerprints, packages: input.packages, palette, sets: input.sets, mobileDesign: input.mobileDesign, iconsSha256: hash(json(icons)), licenseSha256: hash(license.toString().replaceAll('\r\n', '\n')) };
  const generated = { [iconsPath]: json(icons), [snapshotPath]: json(snapshot), [licensePath]: license.toString().replaceAll('\r\n', '\n'), ...outputs(snapshot, icons) };
  for (const [name, contents] of Object.entries(generated)) {
    fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
    fs.writeFileSync(path.join(base, name), contents);
  }
  verify(base);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--check' && process.argv.length === 3) verify();
    else if (process.argv[2] === '--write' && process.argv.length === 3) await write();
    else throw new Error('usage: node android/scripts/shared-ui.mjs --check|--write');
    console.log('Shared native UI assets verified.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
