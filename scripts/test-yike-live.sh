#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${XD_YIKE_TEST_COOKIE:-}" ]]; then
  echo "XD_YIKE_TEST_COOKIE is required. Read it into the environment without putting it in shell history." >&2
  exit 2
fi

go test -mod=readonly -tags=xdrive_yike_live ./internal/yike -run '^TestLiveYikeReadOnly$' -count=1 -v
