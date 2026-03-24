# ────────────────────────────────────────────────────────────
# Stage 1: Build the Rust monad-cli binary
# ────────────────────────────────────────────────────────────
FROM rust:1.88-slim AS builder-rust

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone the monad-core repo to build the CLI binary
RUN git clone --depth 1 https://github.com/Vibe-Loom/vibe-loom-core.git .

# Build only the CLI binary in release mode
RUN cargo build --release -p monad-cli

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
# Stage 3: Production runtime
# ────────────────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built Node.js application from builder-node
COPY --from=builder-node /app/node_modules ./node_modules
COPY --from=builder-node /app/dist ./dist
COPY --from=builder-node /app/prisma ./prisma
COPY --from=builder-node /app/contracts ./contracts
COPY --from=builder-node /app/data ./data
COPY --from=builder-node /app/scripts ./scripts
COPY --from=builder-node /app/package.json ./package.json

# Copy compiled Rust CLI binary from builder-rust
COPY --from=builder-rust /build/target/release/monad-cli /app/monad-cli

# Point the app at the CLI binary
ENV ENGINE_BINARY_PATH=/app/monad-cli

# NestJS listens on port 3000
EXPOSE 3000

# Start with migration + server script
CMD ["sh", "scripts/start.sh"]
