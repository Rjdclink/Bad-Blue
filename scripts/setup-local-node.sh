#!/usr/bin/env sh
set -eu

NODE_VERSION="${NODE_VERSION:-20.19.5}"
TOOLS_DIR="${TOOLS_DIR:-$(pwd)/.tools}"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64) NODE_ARCH="x64" ;;
  aarch64) NODE_ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ARCHIVE="node-v${NODE_VERSION}-linux-${NODE_ARCH}-musl.tar.xz"
BASE_URL="https://unofficial-builds.nodejs.org/download/release/v${NODE_VERSION}"

ORIGINAL_PWD="$(pwd)"

mkdir -p "$TOOLS_DIR"
cd "$TOOLS_DIR"

if [ ! -x "node/bin/node" ]; then
  wget -q "$BASE_URL/$ARCHIVE"
  tar -xJf "$ARCHIVE"
  rm "$ARCHIVE"
  ln -sfn "node-v${NODE_VERSION}-linux-${NODE_ARCH}-musl" node
fi

export PATH="$TOOLS_DIR/node/bin:$PATH"
node --version
npm --version

cd "$ORIGINAL_PWD"