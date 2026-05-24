#!/bin/bash
set -e

echo "==> Deploying Singulary (Docker)..."

docker compose up -d

echo "==> Singulary is running in Docker! Check the logs with: docker compose logs -f"
