#!/bin/bash
# Pterodactyl START BASH FILE for the Bastion Discord bot.
# Works with the generic Node.js (parkervcp) egg when the cloned repo is the
# bastion-auth monorepo (bot lives in /bot) OR a standalone bot repo.
set -e

# Enter the bot directory (monorepo layout) or stay put (standalone repo).
if [ -d /home/container/bot ]; then
  cd /home/container/bot
else
  cd /home/container
fi

echo "[bastion-bot] installing dependencies..."
npm install

echo "[bastion-bot] building..."
npm run build

# Register/refresh slash commands on boot (idempotent; set GUILD_ID in .env for
# instant registration, leave empty for global).
echo "[bastion-bot] registering commands..."
npm run register || echo "[bastion-bot] command registration skipped/failed (continuing)"

echo "[bastion-bot] starting..."
exec node dist/index.js
