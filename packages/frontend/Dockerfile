##############################################################################
# CRM Platform — Frontend Dockerfile
# Builds the Vite SPA and serves it via nginx
# Works for both cloud and on-prem deployments.
##############################################################################

# ── Stage 1: build ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Layer-cache: install deps before copying source
COPY package.json turbo.json ./
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/shared/package.json   ./packages/shared/

RUN npm install --workspaces --include-workspace-root

COPY packages/frontend ./packages/frontend
COPY packages/shared   ./packages/shared

# Build-time env vars (baked into the JS bundle at build time)
# Pass via: docker build --build-arg VITE_API_URL=https://api.yourcrm.com
ARG VITE_API_URL=https://api.yourcrm.com
ARG APP_URL=https://yourcrm.com
ENV VITE_API_URL=$VITE_API_URL
ENV APP_URL=$APP_URL

RUN npm run build --workspace=packages/frontend

# ── Stage 2: runtime (nginx) ───────────────────────────────────────────────
FROM nginx:alpine AS runtime

# Copy built SPA assets
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# nginx config: SPA routing + static asset caching
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=20s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
