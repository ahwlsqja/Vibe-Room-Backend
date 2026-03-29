# ────────────────────────────────────────────────────────────
# Stage 1: C++ Engine Binary (pre-built from Docker Hub)
# ────────────────────────────────────────────────────────────
FROM ahwlsqja/monad-vibe-cli:latest AS cpp-engine

# ────────────────────────────────────────────────────────────
# Stage 2: Build the NestJS application
# ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder-node

WORKDIR /app

# Copy dependency manifests first (better caching)
COPY package.json package-lock.json ./

# Install dependencies without running lifecycle scripts
RUN npm ci --ignore-scripts

# Copy the full backend source (src, prisma, contracts, data, etc.)
COPY . .

# Generate Prisma client from schema
RUN npx prisma generate

# Build the NestJS application
RUN npm run build

# ────────────────────────────────────────────────────────────
# Stage 3: Production runtime — Ubuntu 25.10
# C++ engine needs specific shared libraries; Node.js 20
# is installed manually for NestJS + Prisma.
# ────────────────────────────────────────────────────────────
FROM ubuntu:25.10

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3t64 wget xz-utils \
    # C++ engine shared libs (must match monad-vibe-cli build)
    libboost-fiber1.83.0 \
    libboost-json1.83.0 \
    libboost-stacktrace1.83.0 \
    libtbb12 \
    libzstd1 \
    libgmp10 \
    liburing2 \
    libbrotli1 \
    libcrypto++8 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 manually (needed for NestJS runtime + npx prisma)
RUN wget -q https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz \
    && tar -xf node-v20.18.1-linux-x64.tar.xz -C /usr/local --strip-components=1 \
    && rm node-v20.18.1-linux-x64.tar.xz

WORKDIR /app

# Copy built Node.js application from builder-node
COPY --from=builder-node /app/node_modules ./node_modules
COPY --from=builder-node /app/dist ./dist
COPY --from=builder-node /app/prisma ./prisma
COPY --from=builder-node /app/contracts ./contracts
COPY --from=builder-node /app/data ./data
COPY --from=builder-node /app/scripts ./scripts
COPY --from=builder-node /app/package.json ./package.json

# Copy C++ engine binary from pre-built Docker Hub image
COPY --from=cpp-engine /usr/local/bin/monad-vibe-cli /app/monad-vibe-cli

# Point the app at the CLI binary
ENV ENGINE_BINARY_PATH=/app/monad-vibe-cli

# NestJS listens on port 3000
EXPOSE 3000

# Start with migration + server script
CMD ["sh", "scripts/start.sh"]
