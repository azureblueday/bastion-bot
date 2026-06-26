#!/bin/bash
set -e
cd /home/container
echo "[bastion-bot] installing runtime dependencies..."
npm install --omit=dev
echo "[bastion-bot] registering commands..."
node dist/register-commands.js || echo "[bastion-bot] register skipped (continuing)"
echo "[bastion-bot] starting..."
exec node dist/index.js
