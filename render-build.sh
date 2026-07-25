#!/usr/bin/env bash
set -e
npm install
python3 -m pip install agent-reach twitter_cli rdt x_client_transaction || true
