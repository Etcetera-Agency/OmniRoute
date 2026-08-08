#!/usr/bin/env bash
# Resolve Docker tag/channel from workflow inputs without interpolating shell code.
# AICODE-NOTE: only existing Docker workflow refs resolve here: main, version tags, releases,
# and explicitly requested dispatch versions. Unsupported branch names fail closed.
set -euo pipefail

EVENT_NAME="${1:?event name required}"
REF_TYPE="${2:-}"
REF_NAME="${3:-}"
INPUT_VERSION="${4:-}"

case "$EVENT_NAME" in
  workflow_dispatch)
    VERSION="${INPUT_VERSION#v}"
    ;;
  push)
    if [ "$REF_TYPE" = "tag" ]; then
      VERSION="${REF_NAME#v}"
    else
      case "$REF_NAME" in
        main) VERSION="main" ;;
        *)
          echo "Unsupported Docker publish branch: $REF_NAME" >&2
          exit 1
          ;;
      esac
    fi
    ;;
  release) VERSION="${REF_NAME#v}" ;;
  *) VERSION="${REF_NAME#v}" ;;
esac

if ! printf '%s' "$VERSION" | grep -qE '^[A-Za-z0-9._-]+$'; then
  echo "Refusing to use unsafe VERSION value: $VERSION" >&2
  exit 1
fi

printf '%s\n' "$VERSION"
