# Build stage
FROM node:18-alpine AS builder

# Install dependencies needed for node-gyp and native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Debug: Show what files we have
RUN ls -la

# Debug: Show npm and node versions
RUN node --version && npm --version

# Clear npm cache
RUN npm cache clean --force

# Try npm ci first, fallback to npm install if it fails
RUN npm ci --no-audit --no-fund --verbose || \
    (echo "npm ci failed, trying npm install..." && \
     rm -f package-lock.json && \
     npm install --no-audit --no-fund --verbose)

# Copy source code
COPY . .

# Install Angular CLI globally
RUN npm install -g @angular/cli@16

# Verify installation
RUN ng version

# Build with error handling
RUN ng build --configuration=production --verbose

# Production stage  
FROM nginx:alpine AS production

# Copy built application
COPY --from=builder /app/dist /usr/share/nginx/html

# Create nginx config for Angular SPA
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
