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

# The longest value a setting may have. The app enforces the same number
# (MAX_VALUE_LENGTH in src/lib/config/coerce.ts); failing here puts the reason
# in `docker logs` instead of on a screen nobody has opened yet.
MAX_VALUE_LENGTH=4096

# Refuse a value the app could not use as written, and say which one.
#
# A tab or a line break in a value is never intended: it arrives with a
# pasted secret or a stray keystroke, and what follows is an authentication
# failure that names nothing. These characters used to be dropped silently,
# which turned the mistake into a different value rather than reporting it.
# Every variable is checked before exiting, so one start reports them all.
# The value itself is never printed: one of these is CLIENT_SECRET, and a
# line break in any of them would forge lines in the log.
refused=0
for name in FHIRENDPOINT_URI ISSUER_URI CLIENT_ID CLIENT_SECRET SCOPES SKIP_ISSUER_CHECK; do
  # The names are the fixed list above, never input, so eval is safe here.
  eval "value=\${$name-}"
  # Command substitution drops trailing newlines; the sentinel keeps them.
  kept=$(printf '%sx' "$value" | tr -d '\000-\037')
  if [ "$kept" != "${value}x" ]; then
    echo "swiss: FATAL: $name contains a control character (a tab or line break). Remove it from the env file." >&2
    refused=1
  fi
  if [ "${#value}" -gt "$MAX_VALUE_LENGTH" ]; then
    echo "swiss: FATAL: $name is ${#value} characters long; the limit is $MAX_VALUE_LENGTH." >&2
    refused=1
  fi
done
if [ "$refused" -ne 0 ]; then
  echo "swiss: refusing to start. Fix the env file and recreate the container." >&2
  exit 1
fi

# JSON-escapes one value: backslash and double quote. Control characters were
# refused above; they are still dropped here so that this function alone
# cannot produce invalid JSON. envsubst did none of this, so a value with a
# quote in it produced invalid JSON. The keys mirror config/env.template.json,
# which scripts/render-config.mjs still uses.
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

# Never echo CLIENT_SECRET. The values printed cannot forge a log line: a
# line break in any of them was refused above.
echo "swiss: rendered $TARGET (fhir=${FHIRENDPOINT_URI:-<unset>} issuer=${ISSUER_URI:-<unset>} client=${CLIENT_ID:-<unset>})"
