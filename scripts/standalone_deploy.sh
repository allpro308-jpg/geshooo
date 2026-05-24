#!/bin/bash
set -e

echo "==> Deploying Singulary (Standalone)..."

if [ ! -f "apps/server/dist/main.js" ]; then
  echo "Error: Build not found. Please run scripts/standalone_prepare.sh first."
  exit 1
fi

echo "Starting server..."
pnpm start
