#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
	echo "CLOUDFLARE_API_TOKEN is required in the production Environment." >&2
	exit 1
fi
if [[ -z "${CF_ACCESS_CLIENT_ID:-}" ]]; then
	echo "CF_ACCESS_CLIENT_ID is required in the production Environment." >&2
	exit 1
fi
if [[ -z "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
	echo "CF_ACCESS_CLIENT_SECRET is required in the production Environment." >&2
	exit 1
fi

# Void applies pending D1 migrations before publishing the Worker.
bunx --no-install void deploy --platform cloudflare
