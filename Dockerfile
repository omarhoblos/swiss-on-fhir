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

# ---------- build ----------
# --platform=$BUILDPLATFORM runs this stage once, natively on the build
# machine, whatever platforms the image targets. Its output is static files,
# identical on every platform, so there is nothing to gain from building it
# per platform -- and a multi-arch build otherwise runs npm ci and the app
# build a second time under QEMU emulation for arm64, which took over 12
# minutes on GitHub's runners. Only the small nginx stage below is built per
# platform.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app

# Lockfile first, and `npm ci` rather than `npm install`. The v2 Dockerfile
# copied only package.json before installing, so package-lock.json arrived
# later with `COPY . .` and was never used -- builds were not reproducible.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# --defaults-only is important: a build must never bake in whatever .env
# happens to sit on the build machine. The container renders the real
# swiss-env.json at startup instead.
RUN node scripts/render-config.mjs --defaults-only && npm run build

# ---------- serve ----------
FROM nginx:1.31-alpine AS production

# envsubst. Present in nginx:alpine today via the gettext libs, but depend on
# it explicitly rather than on that continuing to be true.
RUN apk add --no-cache gettext

# adapter-static writes index.html at the root of build/. Copying build/ (not
# dist/) at this depth fixes the v2 bug where angular.json emitted to
# dist/swiss_app while nginx served dist/, putting index.html one level too
# deep so every request 404'd.
COPY --from=build /app/build/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf.template /etc/swiss/security-headers.conf.template
COPY config/env.template.json /etc/swiss/env.template.json

# Config rendering goes in /docker-entrypoint.d/, which the official nginx
# entrypoint runs before starting the server. This is deliberate: it means no
# future edit to CMD can silently drop the substitution step, which is
# exactly the regression that landed between b620867 and ae43078 and left
# --env-file doing nothing at all.
COPY docker/docker-entrypoint.d/40-swiss-config.sh /docker-entrypoint.d/40-swiss-config.sh
COPY docker/docker-entrypoint.d/41-swiss-security-headers.sh /docker-entrypoint.d/41-swiss-security-headers.sh
RUN chmod +x /docker-entrypoint.d/40-swiss-config.sh /docker-entrypoint.d/41-swiss-security-headers.sh

EXPOSE 80

# Probes the rendered config rather than just the index, so a container that
# came up without applying .env reports unhealthy instead of looking fine.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/swiss-env.json || exit 1

# No CMD or ENTRYPOINT override: inherit nginx's, so the entrypoint hook runs.
