#!/usr/bin/env bash
# Copyright 2021 Omar Hoblos
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Builds the image and runs a container from it.
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=scripts/docker-env.sh
. scripts/docker-env.sh

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }

if [ ! -f .env ]; then
  warn "No .env found. Copying .env.example so the container has something to read."
  warn "Edit .env and re-run this script to point Swiss at your own servers."
  cp .env.example .env
fi

bold "Building ${IMAGE_NAME}"
docker build -t "${IMAGE_NAME}" .

# Remove any previous container first, so re-running this is not an error.
if [ -n "$(docker ps -aq -f "name=^${CONTAINER_NAME}$")" ]; then
  bold "Removing the existing ${CONTAINER_NAME} container"
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

bold "Starting ${CONTAINER_NAME} on http://localhost:${HOST_PORT}"
docker run -d \
  -p "${HOST_PORT}:80" \
  --env-file .env \
  --name "${CONTAINER_NAME}" \
  "${IMAGE_NAME}"

bold "Done. Verify the configuration was applied:"
echo "  curl -s http://localhost:${HOST_PORT}/swiss-env.json"
echo
echo "Register this redirect URI with your OAuth client:"
echo "  http://localhost:${HOST_PORT}/callback"
