#!/usr/bin/env bash
# Render Build Script
set -e

echo "==> Installing Node.js dependencies..."
npm install

echo "==> Installing Python dependencies and agent-reach packages..."
python3 -m pip install --upgrade pip
python3 -m pip install agent-reach twitter_cli rdt x_client_transaction

echo "==> Build complete!"
