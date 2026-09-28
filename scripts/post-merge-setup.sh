#!/usr/bin/env bash
set -euo pipefail

# Keep local dependencies in sync without deleting the large existing install.
# --no-save leaves the committed package manifest and lockfile untouched.
npm install --no-save --no-audit --no-fund --prefer-offline

# Do not run npm run migrate here: the legacy runner replays all SQL files,
# including data updates, on every invocation. The dev workflow uses tsx
# directly; the production build belongs to the deployment process.