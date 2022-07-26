#################
# Build the app #
#################
FROM node:18-bullseye as build
RUN apk add --update python make g++\
   && rm -rf /var/cache/apk/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN python3 --version
RUN npm install -g @angular/cli
RUN ng build --configuration production --output-path=/dist

################
# Run in NGINX #
################
FROM nginx:1.23.0 as base
COPY --from=build /dist /usr/share/nginx/html

# When the container starts, replace the env.js with values from environment variables
CMD ["/bin/sh",  "-c",  "envsubst < /usr/share/nginx/html/assets/env.template.js > /usr/share/nginx/html/assets/env.js && exec nginx -g 'daemon off;'"]