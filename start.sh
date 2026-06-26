#!/bin/bash
set -e
cd /home/container
echo "[bastion-bot] installing dependencies (incl dev)..."
npm install --include=dev
echo "[bastion-bot] building..."
npm run build
echo "[bastion-bot] registering commands..."
npm run register || echo "[bastion-bot] register skipped (continuing)"
echo "[bastion-bot] starting..."
exec node dist/index.js
