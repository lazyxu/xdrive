import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APK_NAME = /^xdrive-android-([1-9][0-9]{0,9})-([A-Za-z0-9][A-Za-z0-9.+_-]{0,63})\.apk$/;

/** Pure planner; no network, key or release mutations. */
export function planSignedAndroidRelease({ versionCode, versionName, sourceSha, releases }) {
  if (typeof versionCode !== 'string' ||
      !/^[1-9][0-9]{0,9}$/.test(versionCode) ||
      Number(versionCode) > 2_100_000_000) {
    throw new Error('Invalid Android versionCode (1..2100000000, no leading zeros)');
  }
  if (typeof versionName !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/.test(versionName)) {
    throw new Error('Invalid Android versionName');
  }
  if (typeof sourceSha !== 'string' || !/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error('Require an exact 40-character lowercase master SHA');
  }
  if (!Array.isArray(releases) || releases.length > 100 ||
      releases.some((release) => !release || typeof release !== 'object' ||
        !Array.isArray(release.assets))) {
    throw new Error('Invalid public release metadata; refuse publishing');
  }
  const code = Number(versionCode);
  const releaseTag = 'android-v' + versionCode;
  let highestPublishedCode = 0;
  for (const release of releases) {
    if (release.tag_name === releaseTag) {
      throw new Error('Android release tag already exists: ' + releaseTag);
    }
    if (release.draft) continue;
    for (const asset of release.assets) {
      const match = typeof asset?.name === 'string' && APK_NAME.exec(asset.name);
      if (match) {
        const previous = Number(match[1]);
        if (previous <= 2_100_000_000) {
          highestPublishedCode = Math.max(highestPublishedCode, previous);
        }
      }
    }
  }
  if (code <= highestPublishedCode) {
    throw new Error('Android versionCode must increase beyond ' + highestPublishedCode);
  }
  return Object.freeze({
    versionCode: code,
    versionName,
    sourceSha,
    releaseTag,
    assetName: 'xdrive-android-' + versionCode + '-' + versionName + '.apk',
    highestPublishedCode,
  });
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 6) {
    throw new Error('Usage: node signed-release-plan.mjs <code> <name> <SHA> <releases.json>');
  }
  const [, , versionCode, versionName, sourceSha, metadataPath] = process.argv;
  const releases = JSON.parse(readFileSync(metadataPath, 'utf8'));
  process.stdout.write(JSON.stringify(
    planSignedAndroidRelease({ versionCode, versionName, sourceSha, releases }),
  ) + '\n');
}
