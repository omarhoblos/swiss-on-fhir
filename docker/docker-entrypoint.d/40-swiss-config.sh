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

# Renders the runtime configuration from the container environment.
#
# The official nginx entrypoint executes every /docker-entrypoint.d/*.sh
# before starting nginx, so this cannot be bypassed by an edit to CMD.
set -eu

TEMPLATE=/etc/swiss/env.template.json
# Root-level: a `config/` directory here would shadow the /config route.
TARGET=/usr/share/nginx/html/swiss-env.json

# Explicit allowlist, so envsubst substitutes only these and leaves any other
# dollar sign in the template alone.
VARS='${FHIRENDPOINT_URI} ${ISSUER_URI} ${CLIENT_ID} ${CLIENT_SECRET} ${SCOPES} ${SKIP_ISSUER_CHECK}'

if [ ! -f "$TEMPLATE" ]; then
  echo "swiss: FATAL: $TEMPLATE is missing; the image is built incorrectly." >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"

# Write then move, so nginx never serves a half-written config -- some
# orchestrators have it accepting connections while this runs.
envsubst "$VARS" < "$TEMPLATE" > "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"

# NOTE: envsubst does no JSON escaping, so a value containing a double quote
# or backslash would produce invalid JSON. Config values here are URLs, an
# id, and a scope string, so this is close to theoretical -- and the app
# handles it correctly either way, rendering an explanatory config screen
# rather than a blank page. For an airtight version, replace the envsubst
# call above with printf plus an escaper:
#   esc() { printf '%s' "${1-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# Never echo CLIENT_SECRET.
echo "swiss: rendered $TARGET (fhir=${FHIRENDPOINT_URI:-<unset>} issuer=${ISSUER_URI:-<unset>} client=${CLIENT_ID:-<unset>})"
