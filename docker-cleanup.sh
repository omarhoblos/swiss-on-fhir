#!/usr/bin/env bash
# Removes the container and the image, for a clean start.
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=scripts/docker-env.sh
. scripts/docker-env.sh

bold() { printf '\033[1m%s\033[0m\n' "$1"; }

bold "Removing container ${CONTAINER_NAME}"
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || echo "  (not running)"

# v2 claimed to delete the image and never did.
bold "Removing image ${IMAGE_NAME}"
docker rmi "${IMAGE_NAME}" 2>/dev/null || echo "  (not present)"

bold "Done. Rebuild with ./docker-build.sh"
