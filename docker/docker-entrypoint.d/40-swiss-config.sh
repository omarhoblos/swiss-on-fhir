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

# Root-level: a `config/` directory here would shadow the /config route.
TARGET=/usr/share/nginx/html/swiss-env.json

# JSON-escapes one value: backslash and double quote, with control
# characters dropped. envsubst did none of this, so a value with a quote in
# it produced invalid JSON; the local scripts/render-config.mjs already used
# JSON.stringify, and the two paths now agree. The keys mirror
# config/env.template.json, which render-config.mjs still uses.
esc() {
  printf '%s' "${1-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\037'
}

mkdir -p "$(dirname "$TARGET")"

# Write then move, so nginx never serves a half-written config -- some
# orchestrators have it accepting connections while this runs.
# SKIP_ISSUER_CHECK is retired but still rendered, so a .env that sets it is
# told it can be deleted rather than having it silently ignored.
{
  printf '{\n'
  printf '  "fhirBaseUrl": "%s",\n' "$(esc "${FHIRENDPOINT_URI-}")"
  printf '  "authIssuer": "%s",\n' "$(esc "${ISSUER_URI-}")"
  printf '  "clientId": "%s",\n' "$(esc "${CLIENT_ID-}")"
  printf '  "clientSecret": "%s",\n' "$(esc "${CLIENT_SECRET-}")"
  printf '  "scopes": "%s",\n' "$(esc "${SCOPES-}")"
  printf '  "skipIssuerCheck": "%s"\n' "$(esc "${SKIP_ISSUER_CHECK-}")"
  printf '}\n'
} > "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"

# Never echo CLIENT_SECRET.
echo "swiss: rendered $TARGET (fhir=${FHIRENDPOINT_URI:-<unset>} issuer=${ISSUER_URI:-<unset>} client=${CLIENT_ID:-<unset>})"
