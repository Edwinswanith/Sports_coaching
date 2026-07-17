# syntax=docker/dockerfile:1
# Expo Router app exported as a static web (React Native Web) build, served as
# a single-page app. Build context MUST be the repo root (workspaces):
#   docker build -f apps/mobile/Dockerfile -t scp-web .
#
# NOTE: EXPO_PUBLIC_* vars are inlined into the client bundle at BUILD time
# (same rule as Next.js's NEXT_PUBLIC_*), so the API base URL is a build ARG —
# it must be the URL the user's BROWSER can reach, not a Docker service name.
#
# TOUR_ALWAYS_SHOW is DIFFERENT: it's a RUNTIME env var (set via
# `gcloud run deploy --set-env-vars` / the Cloud Run console), read at
# container startup by docker/entrypoint.sh, not baked in at build time. That
# makes it editable from Cloud Run's env-var UI with no image rebuild — see
# src/lib/tour/MobileTourProvider.tsx for how the client reads it.

# ---------- Build: install all deps, `expo export -p web` ----------
FROM node:20-alpine AS build
WORKDIR /app
ARG EXPO_PUBLIC_API_BASE_URL=http://localhost:4000
ENV EXPO_PUBLIC_API_BASE_URL=$EXPO_PUBLIC_API_BASE_URL
# Google Sign-In web client ID — inlined at build time (verified server-side by
# the API). Falls back to the same default baked into GoogleSignInButton.tsx.
ARG EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
ENV EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=$EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
ARG EXPO_PUBLIC_GOOGLE_ALLOWED_ORIGINS=
ENV EXPO_PUBLIC_GOOGLE_ALLOWED_ORIGINS=$EXPO_PUBLIC_GOOGLE_ALLOWED_ORIGINS
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
RUN npm config set fetch-timeout 600000 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-retries 5 \
  && npm ci --no-audit --fund=false
COPY apps/mobile ./apps/mobile
WORKDIR /app/apps/mobile
RUN npx expo export -p web --output-dir dist
# Inject a <script> tag loading the (not-yet-existing) runtime-config.js as
# the FIRST thing in <head> of every exported page, so it executes before the
# app's own (deferred) bundle script — regardless of which .html file `serve`
# ends up returning for a given route. The file itself is generated fresh at
# container startup by entrypoint.sh, not here.
RUN find dist -name "*.html" -print0 | xargs -0 sed -i 's#<head>#<head><script src="/runtime-config.js"></script>#'

# ---------- Runtime: static file server, non-root ----------
FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g serve@14 && addgroup -S app && adduser -S app -G app
COPY --from=build /app/apps/mobile/dist ./dist
COPY apps/mobile/docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R app:app /app
USER app
EXPOSE 8080
# `-s` (single) makes `serve` fall back to index.html for any unmatched path,
# so expo-router's client-side routing handles dynamic routes like
# /coach/athletes/[athleteId] that can't be pre-rendered as static files.
CMD ["./entrypoint.sh"]
