import { constants, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Packaging only. The publisher must verify a fixed release signing certificate
// with apksigner first; renaming an APK cannot establish signing trust.
export function prepareUpdateAsset(metadataPath, outputDirectory) {
  const data = JSON.parse(readFileSync(metadataPath, 'utf8'));
  if (data.applicationId !== 'com.tfluid.xdrive' || data.variantName !== 'release' || data.elements?.length !== 1) {
    throw new Error('Expected one xDrive release APK (never a debug or split build)');
  }
  const { versionCode, versionName, outputFile } = data.elements[0];
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000 ||
      typeof versionName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/.test(versionName) ||
      outputFile !== 'app-release.apk') {
    throw new Error('Invalid Android version or APK path');
  }
  const source = join(dirname(resolve(metadataPath)), outputFile);
  const bytes = readFileSync(source);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Not an APK container');
  mkdirSync(outputDirectory, { recursive: true });
  const target = join(outputDirectory, `xdrive-android-${versionCode}-${versionName}.apk`);
  copyFileSync(source, target, constants.COPYFILE_EXCL);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node update-asset.mjs <output-metadata.json> <output-directory>');
  console.log(prepareUpdateAsset(process.argv[2], process.argv[3]));
}
