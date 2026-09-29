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

# Feeds hostile environment values to the image's entrypoint scripts.
#
#   docker build -t swiss-on-fhir:ci . && sh docker/test-entrypoints.sh swiss-on-fhir:ci
#
# The scripts are run inside the image, because they are written for its
# shell and its sed, tr and grep, not for the ones on the machine running
# this. Most cases run a script directly rather than starting nginx, so each
# takes a fraction of a second and none binds a port. Needs docker and jq.
set -eu

IMAGE="${1:?usage: sh docker/test-entrypoints.sh <image>}"

CONFIG=/docker-entrypoint.d/40-swiss-config.sh
HEADERS=/docker-entrypoint.d/41-swiss-security-headers.sh
RENDERED=/usr/share/nginx/html/swiss-env.json
SNIPPET=/etc/nginx/snippets/swiss-security-headers.conf

TAB=$(printf '\t')
NL='
'

passed=0
failed=0

ok() {
  passed=$((passed + 1))
  printf '  ok    %s\n' "$1"
}

bad() {
  failed=$((failed + 1))
  printf '  FAIL  %s\n' "$1"
  printf '%s\n' "$OUT" | sed 's/^/        | /'
}

# run <shell script> [docker run options...]
# Sets OUT to everything the container printed and CODE to its exit status.
run() {
  script=$1
  shift
  set +e
  OUT=$(docker run --rm --entrypoint sh "$@" "$IMAGE" -c "$script" 2>&1)
  CODE=$?
  set -e
}

# expect_refused <description> <text the output must contain>
expect_refused() {
  if [ "$CODE" -ne 0 ] && printf '%s' "$OUT" | grep -qF -- "$2"; then
    ok "$1"
  else
    bad "$1 (exit $CODE, wanted non-zero and: $2)"
  fi
}

echo "40-swiss-config.sh"

run "$CONFIG >/dev/null && cat $RENDERED" \
  -e 'CLIENT_ID=quote"back\slash%s$x' \
  -e 'SCOPES=openid patient/*.read' \
  -e 'FHIRENDPOINT_URI=http://fhir.test/a?b=c&d=é'
if [ "$CODE" -eq 0 ] && printf '%s' "$OUT" | jq -e '
    .clientId == "quote\"back\\slash%s$x"
    and .scopes == "openid patient/*.read"
    and .fhirBaseUrl == "http://fhir.test/a?b=c&d=é"
    and .clientSecret == ""' >/dev/null; then
  ok 'quotes, backslashes, % and $ arrive as written, in valid JSON'
else
  bad 'quotes, backslashes, % and $ arrive as written, in valid JSON'
fi

run "$CONFIG" -e "SCOPES=openid${TAB}fhirUser"
expect_refused 'a tab in SCOPES is refused' 'FATAL: SCOPES contains a control character'

run "$CONFIG" -e "FHIRENDPOINT_URI=http://fhir.test${NL}forged log line"
expect_refused 'a line break in FHIRENDPOINT_URI is refused' 'FATAL: FHIRENDPOINT_URI contains a control character'
if printf '%s' "$OUT" | grep -q 'forged log line'; then
  bad 'a refused value is not echoed into the log'
else
  ok 'a refused value is not echoed into the log'
fi

run "$CONFIG" -e "CLIENT_ID=swiss${NL}"
expect_refused 'a trailing line break is refused too' 'FATAL: CLIENT_ID contains a control character'

run "$CONFIG" -e "CLIENT_SECRET=hunter2${TAB}hunter3"
expect_refused 'a tab in CLIENT_SECRET is refused' 'FATAL: CLIENT_SECRET contains a control character'
if printf '%s' "$OUT" | grep -q 'hunter'; then
  bad 'the client secret is never printed'
else
  ok 'the client secret is never printed'
fi

run "$CONFIG" -e "CLIENT_ID=a${TAB}b" -e "ISSUER_URI=http://idp.test${TAB}"
if [ "$CODE" -ne 0 ] &&
  printf '%s' "$OUT" | grep -q 'FATAL: CLIENT_ID' &&
  printf '%s' "$OUT" | grep -q 'FATAL: ISSUER_URI'; then
  ok 'every offending variable is named in one run'
else
  bad 'every offending variable is named in one run'
fi

run "$CONFIG; cat $RENDERED" -e "CLIENT_ID=should-not-render${TAB}"
if printf '%s' "$OUT" | grep -q 'should-not-render'; then
  bad 'nothing is rendered from a refused environment'
else
  ok 'nothing is rendered from a refused environment'
fi

run "$CONFIG" -e "CLIENT_ID=$(head -c 5000 /dev/zero | tr '\0' a)"
expect_refused 'a 5000-character value is refused' 'FATAL: CLIENT_ID is 5000 characters long; the limit is 4096'

run "$CONFIG >/dev/null && cat $RENDERED" -e "CLIENT_ID=$(head -c 4096 /dev/zero | tr '\0' a)"
if [ "$CODE" -eq 0 ] && printf '%s' "$OUT" | jq -e '.clientId | length == 4096' >/dev/null; then
  ok 'a value at the limit is accepted'
else
  bad 'a value at the limit is accepted'
fi

echo "41-swiss-security-headers.sh"

run "$HEADERS >/dev/null && cat $SNIPPET" -e 'FRAME_ANCESTORS=self https://ehr.test https://*.example.org'
if [ "$CODE" -eq 0 ] &&
  printf '%s' "$OUT" | grep -qF "frame-ancestors 'self' https://ehr.test https://*.example.org\""; then
  ok 'a list of origins is rendered, with self quoted'
else
  bad 'a list of origins is rendered, with self quoted'
fi

run "$HEADERS" -e 'FRAME_ANCESTORS=self; script-src *'
expect_refused 'a ; is refused' 'FATAL: FRAME_ANCESTORS has characters'

run "$HEADERS" -e 'FRAME_ANCESTORS=self" always; add_header X-Injected "1'
expect_refused 'a " is refused' 'FATAL: FRAME_ANCESTORS has characters'

run "$HEADERS" -e "FRAME_ANCESTORS=self${NL}https://x.test"
expect_refused 'a line break is refused' 'FATAL: FRAME_ANCESTORS must be a single line'

run "$HEADERS" -e "FRAME_ANCESTORS=self$(printf '\r')"
expect_refused 'a carriage return is refused' 'FATAL: FRAME_ANCESTORS must be a single line'

run "$HEADERS" -e "FRAME_ANCESTORS=https://$(head -c 5000 /dev/zero | tr '\0' a).test"
expect_refused 'a value nginx could not parse is refused here, by name' 'FATAL: FRAME_ANCESTORS is 5013 characters long; the limit is 2048'

# Only the rendered file is read here: the refusal itself quotes the value.
run "$HEADERS 2>/dev/null; cat $SNIPPET 2>/dev/null" -e 'FRAME_ANCESTORS=self; add_header X-Injected 1'
if printf '%s' "$OUT" | grep -q 'add_header X-Injected'; then
  bad 'nothing is rendered from a refused value'
else
  ok 'nothing is rendered from a refused value'
fi

echo "whole container"

# The real entrypoint, so this covers the wiring: a refusal in a hook must
# stop nginx from starting at all. Detached and polled, because if it did
# start it would run until killed and a plain `docker run` would hang here.
name="swiss_entrypoint_test_$$"
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -e "SCOPES=openid${TAB}fhirUser" "$IMAGE" >/dev/null
state=running
for _ in 1 2 3 4 5 6 7 8 9 10; do
  state=$(docker inspect -f '{{.State.Status}}' "$name")
  [ "$state" = running ] || break
  sleep 1
done
CODE=$(docker inspect -f '{{.State.ExitCode}}' "$name")
OUT=$(docker logs "$name" 2>&1)
docker rm -f "$name" >/dev/null 2>&1 || true
if [ "$state" = exited ] && [ "$CODE" -ne 0 ] &&
  printf '%s' "$OUT" | grep -q 'FATAL: SCOPES contains a control character'; then
  ok 'a refused environment stops the container before nginx starts'
else
  bad "a refused environment stops the container before nginx starts (state $state, exit $CODE)"
fi

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
