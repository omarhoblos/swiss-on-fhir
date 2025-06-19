# Debug version with more verbose output
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with verbose output
RUN npm ci --verbose

# Copy source code
COPY . .

# Install Angular CLI and show version
RUN npm install -g @angular/cli@16
RUN ng version

# List files to verify structure
RUN ls -la

# Build with verbose output and error handling
RUN ng build --configuration=production --verbose || (echo "Build failed" && cat /tmp/ng-* 2>/dev/null || true && exit 1)

# List dist contents
RUN ls -la dist/

# Production stage
FROM nginx:alpine AS production

# Copy built application (adjust path based on your project name)
COPY --from=builder /app/dist/your-app-name /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
