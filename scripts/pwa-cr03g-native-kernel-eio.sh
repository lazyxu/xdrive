#!/usr/bin/env bash
set -euo pipefail
# CR03g: isolated Linux block fault for actual Chromium IndexedDB.
# No production storage, existing host block device or user credentials.
test "$CI" = true
test "$GITHUB_ACTIONS" = true
test "$XD_PWA_CR03G_NATIVE_EIO" = 1
test -n "$RUNNER_TEMP" && test -n "$GITHUB_RUN_ID"
test -n "$XD_PR_HEAD" && test -n "$XD_PWA_CR03G_OUTPUT"
[[ "$XD_PR_HEAD" =~ ^[a-f0-9]{40}$ ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]{1,20}$ ]]
test "$(id -u)" -ne 0
test -d "$RUNNER_TEMP"
test "$(realpath -m "$RUNNER_TEMP")" = "$RUNNER_TEMP"
ROOT="$RUNNER_TEMP/xdrive-pwa-cr03g-private"
PROFILE="$ROOT/pwa-cr03g-private-profile"
MOUNT="$PROFILE/Default/IndexedDB"
IMAGE="$ROOT/disposable-256m.ext4"
DM="xd-pwa-cr03g-$GITHUB_RUN_ID"
DEVICE="/dev/mapper/$DM"
LOOP=""
SECTORS=""
MAPPED=0
umask 077
test ! -e "$ROOT"
mkdir -p "$MOUNT"
truncate -s 256M "$IMAGE"
cleanup() {
  local failure=0
  set +e
  # Restore only the exact private mapper before ANY unmount attempt.
  if test "$MAPPED" = 1 && test -n "$LOOP" && test -n "$SECTORS"; then
    sudo timeout 12s dmsetup suspend --noflush "$DM" >/dev/null 2>&1
    sudo timeout 12s dmsetup reload "$DM" --table "0 $SECTORS linear $LOOP 0" >/dev/null 2>&1
    sudo timeout 12s dmsetup resume "$DM" >/dev/null 2>&1
  fi
  if mountpoint -q "$MOUNT"; then
    sudo timeout 20s umount "$MOUNT" >/dev/null 2>&1 || failure=1
  fi
  if test "$MAPPED" = 1; then
    sudo timeout 12s dmsetup remove "$DM" >/dev/null 2>&1 || failure=1
  fi
  if test -n "$LOOP"; then
    sudo losetup -d "$LOOP" >/dev/null 2>&1 || failure=1
  fi
  if sudo dmsetup info "$DM" >/dev/null 2>&1; then
    echo "CR03g disposable mapper remained after cleanup" >&2
    failure=1
  fi
  if test -n "$LOOP" && sudo losetup -j "$IMAGE" | grep -q .; then
    echo "CR03g disposable loop remained after cleanup" >&2
    failure=1
  fi
  if mountpoint -q "$MOUNT"; then
    echo "CR03g disposable IndexedDB mount remained" >&2
    failure=1
  fi
  if test "$failure" != 0; then
    echo "CR03g private cleanup failed; leaving scratch for runner shutdown" >&2
    exit 1
  fi
  if test "$ROOT" = "$RUNNER_TEMP/xdrive-pwa-cr03g-private" &&
      test "$ROOT" != /; then rm -rf -- "$ROOT"; fi
}
trap cleanup EXIT
LOOP="$(sudo losetup --find --show "$IMAGE")"
[[ "$LOOP" =~ ^/dev/loop[0-9]+$ ]]
SECTORS="$(sudo blockdev --getsz "$LOOP")"
[[ "$SECTORS" =~ ^[0-9]+$ ]]
test "$SECTORS" -eq 524288
if sudo dmsetup info "$DM" >/dev/null 2>&1; then
  echo "CR03g disposable mapper unexpectedly exists" >&2
  exit 1
fi
sudo timeout 12s dmsetup create "$DM" --table "0 $SECTORS linear $LOOP 0"
MAPPED=1
test -b "$DEVICE"
# Format ONLY the freshly created mapper backed by our new scratch image.
sudo timeout 20s mkfs.ext4 -q -F "$DEVICE"
sudo timeout 20s mount -t ext4 -o nodev,nosuid "$DEVICE" "$MOUNT"
mountpoint -q "$MOUNT"
sudo chown "$(id -u):$(id -g)" "$MOUNT"
test "$(stat -c %d "$MOUNT")" != "$(stat -c %d "$PROFILE")"
# Actual kernel direct read before switching the mapping.
sudo timeout 12s dd if="$DEVICE" of=/dev/null bs=4096 count=1 iflag=direct status=none
export XD_PWA_CR03G_LOOP_DEV="$LOOP"
export XD_PWA_CR03G_DM_NAME="$DM"
node desktop/scripts/pwa-cr03g-native-kernel-eio.cjs
node - <<'NODE'
const fs=require('node:fs')
const s=JSON.parse(fs.readFileSync(process.env.XD_PWA_CR03G_OUTPUT+'/summary.json','utf8'))
const required=['passed','nativeChromium','isolatedMount','kernelEIO',
 'mountRestored','originalConsent','originalDirectory','originalAlbum',
 'readOnlyUIHistoricalOrEmpty','productWriteRejected','durablePurgeRejected',
 'peerPurgeNotified','postRestoreNoNewRow','postRestoreNotAuthorized',
 'publicSWOnly','physicalDiskEIO','chromiumIndexedDBTested','nativeIDBFailureObserved']
if(s.sha!==process.env.XD_PR_HEAD || required.some(key=>s[key]!==true) ||
 s.physicalIOS || s.productionCodeModified)process.exit(1)
console.log('PWA_CR03G_TRUE_CHROMIUM_KERNEL_EIO_PASSED '+s.sha.slice(0,12))
NODE
