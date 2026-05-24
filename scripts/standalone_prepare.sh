#!/bin/bash
set -e

echo "==> Preparing Singulary for Standalone Deployment..."

echo "1. Installing dependencies..."
pnpm install

echo "2. Building packages and apps..."
pnpm build

echo "==> Preparation complete! You can now run standalone_deploy.sh"
