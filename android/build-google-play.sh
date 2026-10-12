#!/usr/bin/env bash
set -euo pipefail

# Generate and build an Android TWA from the production LegalWhat PWA.
# Run from an environment with Android SDK, JDK and network access.
# This does not modify or deploy the website.

MANIFEST_URL="https://legalwhat.com/manifest.json"
command -v node >/dev/null || { echo "Node.js is required" >&2; exit 1; }
command -v java >/dev/null || { echo "JDK is required" >&2; exit 1; }
command -v bubblewrap >/dev/null || { echo "Install @bubblewrap/cli first" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

curl --fail --silent --show-error "$MANIFEST_URL" >/dev/null
mkdir -p legalwhat-android-build
cd legalwhat-android-build

if [[ ! -f twa-manifest.json ]]; then
  echo "Bubblewrap setup will request Android package, icons and signing details."
  bubblewrap init --manifest="$MANIFEST_URL"
fi

# Bubblewrap will ask for signing credentials securely as needed.
bubblewrap build

echo "Check the resulting Android App Bundle and APK in $(pwd)."
echo "DO NOT submit until the Play payments review, asset links, and device tests pass."
