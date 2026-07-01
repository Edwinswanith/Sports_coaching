# syntax=docker/dockerfile:1
# Next.js (App Router) frontend. Build context MUST be the repo root (workspaces):
#   docker build -f apps/web/Dockerfile -t scp-web .
#
# NOTE: NEXT_PUBLIC_* vars are inlined into the client bundle at BUILD time, so
# the API base URL is a build ARG (not a runtime env). It must be the URL the
# user's BROWSER can reach — i.e. the host-mapped server port, not a Docker
# service name.

# ---------- Build: install all deps, run `next build` ----------
FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
# Google Sign-In client ID — inlined into the client bundle at build time. Empty
# = the "Sign in with Google" button hides itself (feature off).
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
COPY apps/web ./apps/web
RUN npm run build -w apps/web

# ---------- Runtime: prod deps + prebuilt .next, non-root ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY apps/web/next.config.js ./apps/web/next.config.js
USER app
EXPOSE 3000
# `next start` serves the prebuilt .next on port 3000 (apps/web/package.json `start`)
CMD ["npm", "run", "start", "-w", "apps/web"]
