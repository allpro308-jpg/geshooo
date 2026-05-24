#!/bin/bash
set -e

echo "==> Preparing Singulary for Docker Deployment..."

echo "Building Docker image..."
docker compose build

echo "==> Docker preparation complete! You can now run docker_deploy.sh"
