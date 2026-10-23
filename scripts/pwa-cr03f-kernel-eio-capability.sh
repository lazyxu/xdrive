#!/usr/bin/env bash
set -euo pipefail
# CR03f F0: kernel device-mapper EIO CAPABILITY TEST ONLY.
# Ephemeral GitHub runner, fixed scratch loopback; not a Chrome/IDB test.
test "$CI" = true
test "$GITHUB_ACTIONS" = true
test "$XD_PWA_CR03F_CAPABILITY" = 1
test -n "$RUNNER_TEMP"
test -n "$GITHUB_RUN_ID"
test -n "$XD_PR_HEAD"
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$XD_PR_HEAD" =~ ^[a-f0-9]{40}$ ]]
test "$(id -u)" -ne 0
test "$(realpath -m "$RUNNER_TEMP")" = "$RUNNER_TEMP"
test -d "$RUNNER_TEMP"
ROOT="$RUNNER_TEMP/xdrive-pwa-cr03f-private-capability"
IMAGE="$ROOT/only-synthetic-64m.img"
LOOP=""
DM="xd-pwa-cr03f-$GITHUB_RUN_ID"
DEVICE="/dev/mapper/$DM"
FAULTED=0
MAPPED=0
umask 077
cleanup() {
  set +e
  if test "$MAPPED" = 1; then
    if test "$FAULTED" = 1 && test -n "$LOOP"; then
      sudo timeout 10s dmsetup suspend "$DM" >/dev/null 2>&1
      sudo timeout 10s dmsetup reload "$DM" --table "0 $SECTORS linear $LOOP 0" >/dev/null 2>&1
      sudo timeout 10s dmsetup resume "$DM" >/dev/null 2>&1
    fi
    sudo timeout 10s dmsetup remove "$DM" >/dev/null 2>&1
  fi
  if test -n "$LOOP"; then sudo losetup -d "$LOOP" >/dev/null 2>&1; fi
  # Never remove the backing file while the private kernel mappings remain.
  if sudo dmsetup info "$DM" >/dev/null 2>&1; then
    echo "CR03f disposable mapper still active after cleanup" >&2
    exit 1
  fi
  if test -n "$LOOP" && sudo losetup -j "$IMAGE" | grep -q .; then
    echo "CR03f disposable loopback still attached" >&2
    exit 1
  fi
  if test "$ROOT" = "$RUNNER_TEMP/xdrive-pwa-cr03f-private-capability" && test "$ROOT" != /; then
    rm -rf -- "$ROOT"
  fi
}
trap cleanup EXIT
test ! -e "$ROOT"
mkdir -m 0700 "$ROOT"
truncate -s 64M "$IMAGE"
LOOP="$(sudo losetup --find --show "$IMAGE")"
[[ "$LOOP" =~ ^/dev/loop[0-9]+$ ]]
SECTORS="$(sudo blockdev --getsz "$LOOP")"
[[ "$SECTORS" =~ ^[0-9]+$ ]]
test "$SECTORS" -ge 131072
sudo timeout 10s dmsetup create "$DM" --table "0 $SECTORS linear $LOOP 0"
MAPPED=1
test -b "$DEVICE"
# A genuine direct block read must work before the fault.
sudo timeout 10s dd if="$DEVICE" of=/dev/null bs=4096 count=1 iflag=direct status=none
sudo timeout 10s dmsetup suspend "$DM"
sudo timeout 10s dmsetup reload "$DM" --table "0 $SECTORS error"
sudo timeout 10s dmsetup resume "$DM"
FAULTED=1
# A nonzero status alone is insufficient: demand the kernel EIO text.
if sudo timeout 10s dd if="$DEVICE" of=/dev/null bs=4096 count=1 iflag=direct status=none \
  > "$ROOT/eio.stdout" 2> "$ROOT/eio.stderr"; then
  echo "CR03f fault target still served data; no EIO evidence" >&2
  exit 1
fi
if ! grep -qi 'Input/output error' "$ROOT/eio.stderr"; then
  echo "CR03f returned a different error; no kernel EIO evidence" >&2
  exit 1
fi
sudo timeout 10s dmsetup suspend "$DM"
sudo timeout 10s dmsetup reload "$DM" --table "0 $SECTORS linear $LOOP 0"
sudo timeout 10s dmsetup resume "$DM"
FAULTED=0
# The same brand-new, temporary block mapping must really recover.
sudo timeout 10s dd if="$DEVICE" of=/dev/null bs=4096 count=1 iflag=direct status=none
test -n "$XD_PWA_CR03F_OUT"
OUT="$XD_PWA_CR03F_OUT"
test "$OUT" != / && test "$(basename "$OUT")" = summary.json
mkdir -p "$(dirname "$OUT")"
printf '{"schema":"xdrive-pwa-cr03f-real-block-eio-capability-v1","sha":"%s","kernelDirectReadBefore":true,"kernelBlockEIO":true,"mappingRestored":true,"kernelDirectReadAfter":true,"privateDeviceOnly":true,"chromiumIndexedDBTested":false,"physicalIOS":false,"productionModified":false}\n' \
  "$XD_PR_HEAD" > "$OUT"
echo "PWA_CR03F_GENUINE_KERNEL_EIO_CAPABILITY $XD_PR_HEAD"
