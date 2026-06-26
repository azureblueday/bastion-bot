# Bastion Discord Bot (v2)

Operator bot for managing keys on the Bastion auth platform. Unlike the v1 bot
(which authenticated with a static `Authorization: Bearer <apiKey>`), this bot
signs **every** request with HMAC-SHA256 and a one-time nonce, matching the
server's `verifyBotRequest` guard.

## Request signing

For each call the bot computes:

```
payload   = METHOD + url.pathname + rawBody + timestamp + nonce
signature = HMAC-SHA256(BOT_HMAC_KEY, payload)
```

and sends `x-bot-signature`, `x-bot-timestamp` (unix seconds), `x-bot-nonce`
(16 random bytes). The server rejects the request if the timestamp drifts more
than 30s or if the nonce was already used (Redis replay guard, 120s TTL).

`BOT_HMAC_KEY` must equal the server's `BOT_HMAC_KEY`. It is a server-to-server
secret and must never be committed or shared.

## Universal / per-guild

The bot is **global and multi-server**. There is no single panel config in env —
each server configures its own panel via `/setpanel`, stored per-guild in the
backend (`GuildPanel`). Access to operator commands is granted by **Manage
Server** or the guild's configured `manager_role` (plus optional global
`OWNER_IDS`). Buyer keys are matched across all projects, so no project binding
is required for redeem/stats/reset.

## Buyer panel

`/setpanel loader_script:<file> buyer_role:<role> manager_role:<role>` stores the
config for that server and posts the **Script Panel** with five buttons:

| Button | What it does |
|---|---|
| 🔑 Redeem Key | Modal to enter a key → validates it, links the buyer's Discord, grants the buyer role |
| 📜 Get Script | DMs/shows the `loadstring` loader pre-filled with the buyer's key (active keys only) |
| 👤 Get Role | Grants the buyer role to anyone with a linked active key |
| ⚙️ Reset HWID | Resets the buyer's own HWID (in-memory cooldown, `HWID_COOLDOWN_HOURS`) |
| 📊 Get Stats | Shows the buyer's status, expiry, executions, HWID state |

The panel is wired by env: `PANEL_PROJECT_ID` (which project keys live in),
`SCRIPT_PUBLIC_ID` (loader for Get Script), `BUYER_ROLE_ID` (role to grant).
Role changes use Discord's REST API, so **no privileged intents are required** —
but the bot's role must sit **above** the buyer role and have *Manage Roles*.

## Admin commands

| Command | Description |
|---|---|
| `/setpanel` | Post the buyer script panel in this channel |
| `/test` | Confirm the bot is online and authenticated |
| `/generate [project_id] count days lifetime note` | Generate keys for a project |
| `/mass-generate count days lifetime [project_id] note` | Generate many keys at once |
| `/whitelist user days lifetime [project_id]` | Create a key, link the user, grant role, DM the key |
| `/unwhitelist user` | Revoke a user's keys and remove their role |
| `/blacklist user reason` | Lock all a user's keys and remove their role |
| `/force-resethwid user` | Reset a user's HWID, ignoring the cooldown |
| `/lookup key user discord_id project_id` | Look up keys by raw key or Discord user |
| `/resethwid key_id` | Reset a key's HWID (by key ID) |
| `/lock key_id reason` / `/unlock key_id` | Lock / unlock a key by ID |
| `/link key_id user` | Link a Discord user to a key by ID |
| `/stats [project_id]` | Key statistics for a project (or all) |

Admin replies are ephemeral and restricted to `OWNER_IDS` (comma list); leave
empty to allow everyone. Buyer panel buttons are open to all members.

## Required bot permissions / intents

- **Intents:** only `Guilds` (no privileged intents).
- **Permissions:** *Send Messages*, *Embed Links*, and *Manage Roles* (with the
  bot role positioned above `BUYER_ROLE_ID`).

## Setup

```bash
cd bot
cp .env.example .env   # fill in token, client id, BOT_HMAC_KEY, OWNER_IDS
npm install
npm run register       # register slash commands (guild if GUILD_ID set, else global)
npm run dev            # or: npm run build && npm start
```
