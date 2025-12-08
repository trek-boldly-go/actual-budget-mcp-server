# Build the app and runtime image
FROM node:24 AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Prune dev dependencies for runtime
RUN npm prune --omit=dev

FROM node:24 AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy only what we need into the final image
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/mcp.svg ./

EXPOSE 3000
CMD ["node", "dist/server.js"]
