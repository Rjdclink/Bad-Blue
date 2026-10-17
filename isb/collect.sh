#!/usr/bin/env bash
# Read-only snapshots of Railway edge HTTP logs. Run externally, never in the app request path.
set -euo pipefail
readonly PROJECT='51340040-15c4-4d74-b60e-8471bdcae20e'
readonly HERE="$(cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v railway >/dev/null 2>&1; then
  printf 'ISB monitoring unavailable: Railway CLI not installed. No website changes made.\n' >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  printf 'ISB monitoring unavailable: Node.js not installed. No website changes made.\n' >&2
  exit 2
fi
get_logs() {
  railway logs --http --json --lines 500 --project "$PROJECT" --environment production --service "$1"
}
{
  get_logs 'Bad-Blue'
  get_logs 'lexara-ddgs'
  get_logs 'lexara-openserp'
} | node "$HERE/monitor.cjs"
