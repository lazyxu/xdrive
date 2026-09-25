#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: download-with-fallback.sh DEST URL [URL...]" >&2
  exit 2
fi

dest="$1"
shift
attempts="${XDRIVE_CI_DOWNLOAD_ATTEMPTS:-5}"
mkdir -p "$(dirname "$dest")"

for url in "$@"; do
  [[ -n "$url" ]] || continue
  echo "[ci-download] source: $url"
  for attempt in $(seq 1 "$attempts"); do
    current_size=0
    [[ -f "$dest" ]] && current_size="$(wc -c < "$dest" | tr -d ' ')"
    if (( current_size > 0 )); then
      echo "[ci-download] attempt $attempt/$attempts; resume from $current_size bytes"
    else
      echo "[ci-download] attempt $attempt/$attempts"
    fi

    set +e
    curl -fL --show-error \
      --connect-timeout 15 \
      --retry 2 \
      --retry-all-errors \
      --retry-delay 2 \
      --speed-time 90 \
      --speed-limit 1024 \
      --continue-at - \
      --output "$dest" \
      "$url"
    rc=$?
    set -e

    if [[ "$rc" -eq 0 ]]; then
      echo "[ci-download] complete: $dest ($(wc -c < "$dest" | tr -d ' ') bytes)"
      exit 0
    fi

    if [[ "$rc" -eq 33 && -f "$dest" ]]; then
      echo "[ci-download] source cannot resume; restarting this source from zero" >&2
      rm -f "$dest"
    fi
    sleep $((attempt * 2))
  done
  echo "[ci-download] source failed after $attempts attempts: $url" >&2
done

echo "[ci-download] download failed from all configured sources: $dest" >&2
exit 1
