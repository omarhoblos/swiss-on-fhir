#!/bin/sh
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

# Serves the deployment's optional environments file.
#
# An operator mounts an environments file -- the format the Config page
# exports -- at SOURCE, and every visitor sees its environments beside
# Default. Its own directory, not /etc/swiss: mounting a directory over
# /etc/swiss would hide the security-header template 41 reads.
#
#   -v ./environments.json:/etc/swiss-environments/environments.json:ro
#
# Like 40 and 41, it runs from the official entrypoint's hook before nginx
# starts, and refuses input it cannot serve rather than altering it.
set -eu

SOURCE=/etc/swiss-environments/environments.json
# Root-level: a served directory would shadow a route. See RUNTIME_CONFIG_PATH.
TARGET=/usr/share/nginx/html/swiss-environments.json
# The app reads at most this much (MAX_ENVIRONMENTS_FILE_LENGTH in
# src/lib/environments/format.ts); refusing here puts the reason in
# `docker logs` instead of on a Config page nobody has opened yet.
MAX_BYTES=1000000

if [ ! -e "$SOURCE" ] && [ ! -L "$SOURCE" ]; then
  # Nothing mounted. A copy left by an earlier start must not keep serving.
  rm -f "$TARGET"
  exit 0
fi

# Docker creates a directory at the mount point when the file named on the
# host side does not exist: the classic way this goes wrong.
if [ -d "$SOURCE" ]; then
  echo "swiss: FATAL: $SOURCE is a directory. Docker makes one when the file on the host side of the volume does not exist; check that path." >&2
  exit 1
fi
# -f follows symlinks, so a Kubernetes ConfigMap mount is accepted.
if [ ! -f "$SOURCE" ]; then
  echo "swiss: FATAL: $SOURCE is not a regular file." >&2
  exit 1
fi
if [ ! -r "$SOURCE" ]; then
  echo "swiss: FATAL: $SOURCE cannot be read by the nginx user. Make it world-readable (chmod 644)." >&2
  exit 1
fi

size=$(wc -c < "$SOURCE" | tr -d ' ')
if [ "$size" -gt "$MAX_BYTES" ]; then
  echo "swiss: FATAL: $SOURCE is $size bytes; the limit is $MAX_BYTES." >&2
  exit 1
fi

# The image has no JSON parser, so the app checks the rest and reports it on
# the Config page. A file that is not even an object is refused here.
first=$(tr -d ' \t\r\n' < "$SOURCE" | head -c 1)
if [ "$first" != "{" ]; then
  echo "swiss: FATAL: $SOURCE does not hold a JSON object. Export one from the Config page to see the format." >&2
  exit 1
fi

# Write then move, so nginx never serves a half-written file.
cp "$SOURCE" "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"
echo "swiss: serving $SOURCE at /swiss-environments.json ($size bytes)"
