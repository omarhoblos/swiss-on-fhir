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


# Renders the security headers, including frame-ancestors from the
# container environment. Runs after 40-swiss-config.sh and, like it, before
# nginx starts, from the official entrypoint's /docker-entrypoint.d/ hook.
set -eu
# FRAME_ANCESTORS may contain `*` (https://*.example.org); never glob it.
set -f

TEMPLATE=/etc/swiss/security-headers.conf.template
TARGET=/etc/nginx/snippets/swiss-security-headers.conf

raw="${FRAME_ANCESTORS:-self}"

# The value lands inside a quoted nginx directive. A `"` or `;` would break
# the config, so refuse anything a frame-ancestors source list cannot hold,
# and say why, rather than let nginx fail with a parse error.
if printf '%s' "$raw" | grep -q "[^A-Za-z0-9 .:/*'_-]"; then
  echo "swiss: FATAL: FRAME_ANCESTORS has characters a frame-ancestors list cannot contain: $raw" >&2
  echo "swiss: use space-separated origins, e.g. FRAME_ANCESTORS=self https://ehr.example.org" >&2
  exit 1
fi

# `self` and `none` are CSP keywords and must be single-quoted in the header.
# Accept them bare, because docker run --env-file keeps quotes literally
# while Compose strips them, so a quoted value in .env is unreliable.
sources=""
for source in $raw; do
  case "$source" in
    self | "'self'") source="'self'" ;;
    none | "'none'") source="'none'" ;;
  esac
  sources="$sources $source"
done
sources="${sources# }"
[ -n "$sources" ] || sources="'self'"

mkdir -p "$(dirname "$TARGET")"
FRAME_ANCESTORS="$sources" envsubst '${FRAME_ANCESTORS}' < "$TEMPLATE" > "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"

echo "swiss: frame-ancestors $sources"
