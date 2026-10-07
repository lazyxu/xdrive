#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
analyzer_dir="$ROOT/services/photo-face-analyzer"
dockerfile="$analyzer_dir/Dockerfile"

{
  printf '%s\0' 'Dockerfile:runtime'
  sed '/^FROM runtime AS final$/,$d' "$dockerfile"
  printf '\0%s\0' 'requirements.txt'
  cat "$analyzer_dir/requirements.txt"
  printf '\0%s\0' 'fetch_models.py'
  cat "$analyzer_dir/fetch_models.py"
} | sha256sum | awk '{print $1}'
