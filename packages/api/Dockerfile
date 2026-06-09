##############################################################################
# AI Operations Platform — API (tsx runtime)
# Runs the TypeScript directly with tsx (same as `npm run dev`), so the broken
# production `tsc` build is not required. Suitable for Railway / Render / Fly.
##############################################################################

FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache tini wget
ENTRYPOINT ["/sbin/tini", "--"]

# Copy workspace manifests + all source, then install ALL deps (incl dev → tsx).
# (NODE_ENV is set AFTER install so devDependencies like tsx are not skipped.)
COPY package.json turbo.json ./
COPY packages ./packages
COPY modules  ./modules

RUN npm install --workspaces --include-workspace-root

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT:-3000}/health" || exit 1

# Run migrations (tsx) then start the server (tsx) — no tsc build needed
CMD ["sh", "-c", "npx tsx packages/api/src/scripts/migrate.ts && npx tsx packages/api/src/server.ts"]
