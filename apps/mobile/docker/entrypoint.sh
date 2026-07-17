#!/bin/sh
# Runs at CONTAINER STARTUP (not Docker build time) so it re-reads Cloud Run's
# live env vars every time a new revision boots — that's what lets changing
# TOUR_ALWAYS_SHOW in the Cloud Run console + deploying a new revision take
# effect with no image rebuild.
set -e

TOUR_ALWAYS_SHOW="${TOUR_ALWAYS_SHOW:-false}"

cat > /app/dist/runtime-config.js <<EOF
window.__RUNTIME_CONFIG__ = { TOUR_ALWAYS_SHOW: "${TOUR_ALWAYS_SHOW}" };
EOF

echo "runtime-config.js written: TOUR_ALWAYS_SHOW=${TOUR_ALWAYS_SHOW}"

exec serve -s dist -l "tcp://0.0.0.0:${PORT:-8080}"
